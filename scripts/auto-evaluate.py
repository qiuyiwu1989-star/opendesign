#!/usr/bin/env python3
"""OpenDesign daily curation recommender.

The runner writes append-only AI recommendations for human review. It never
publishes a site, changes the final curation status, or creates a job.

Production mode reads pending discoveries through ``runner_list_pending`` and
uses two idempotent RPC contracts:

* ``runner_find_curation_decision(p_token, p_decision_fingerprint)``
* ``runner_record_curation_decision(..., p_decision_fingerprint)``

``--fixture`` is an offline-only mode and implies ``--dry-run``. No model,
website, DNS, or database request is made in fixture mode.
"""

from __future__ import annotations

import argparse
import hashlib
import html as html_lib
import ipaddress
import json
import os
import re
import socket
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlsplit


ROOT = Path(__file__).parent.parent.resolve()

SB_URL = os.environ.get("SB_URL", "").rstrip("/")
SB_KEY = os.environ.get("SB_ANON_KEY", "")
TOKEN = os.environ.get("RUNNER_TOKEN", "")
AI_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
AI_BASE = os.environ.get("ANTHROPIC_BASE_URL", "https://api.anthropic.com").rstrip("/")
AI_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-3-haiku-20240307")

DEFAULT_BATCH_LIMIT = int(os.environ.get("AUTO_EVAL_BATCH_LIMIT", "50"))
POLICY_VERSION = "opendesign-curation-v1.1"
EVIDENCE_MIN_SCORE = 50

SIGNAL_DEFINITIONS = (
    ("design-value", "设计参考价值"),
    ("originality", "原创性"),
    ("utility", "可复用价值"),
    ("evidence", "证据完整度"),
    ("spam-risk", "垃圾风险控制"),
    ("ad-risk", "广告风险控制"),
    ("safety", "安全性"),
)
SIGNAL_IDS = tuple(item[0] for item in SIGNAL_DEFINITIONS)
SIGNAL_ID_SET = set(SIGNAL_IDS)
HARD_REJECT_IDS = {"spam-risk", "ad-risk", "safety"}
ALLOWED_RECOMMENDATIONS = {"approve", "review", "reject"}
ALLOWED_STATES = {"pass", "warn", "fail"}
MAX_EVIDENCE_ITEMS = 3
MAX_EVIDENCE_LENGTH = 160
MAX_REASON_LENGTH = 1000
MAX_MODEL_RESPONSE_BYTES = 32768
MAX_SIGNALS_BYTES = 15000


EVAL_PROMPT = """\
You are the daily curator for OpenDesign, an evidence-backed design library.
Return one strict JSON object and no prose.

URL: {url}
Title: {title}
Description: {description}

The object must contain recommendation (approve|review|reject), integer
confidence (0..100), a concise non-empty reason, and exactly seven signals.
Signals must use each id exactly once, in this order:
design-value, originality, utility, evidence, spam-risk, ad-risk, safety.
Every signal needs: id, short label, state (pass|warn|fail), integer score
(0..100), and 1..3 short factual evidence strings (maximum 160 characters
each). Score 100 always means the
candidate passes that quality bar. For spam-risk/ad-risk/safety, a low score
means high risk and state=fail means a hard rejection.

Hard reject affiliate/ad directories, SEO farms, impersonation, duplicated
aggregators, malicious downloads, keyword stuffing, and unrelated content.
If evidence is insufficient, set the evidence signal to fail or below 50 and
recommend review. Never invent evidence.
"""


class DecisionSchemaError(ValueError):
    """Raised when a model decision is not exactly within the policy schema."""


def rpc(name: str, params: dict[str, Any]) -> Any:
    body = json.dumps(params, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        f"{SB_URL}/rest/v1/rpc/{name}",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "apikey": SB_KEY,
            "Authorization": f"Bearer {SB_KEY}",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        raw = response.read().decode("utf-8")
    return json.loads(raw) if raw.strip() else None


def _is_public_ip(value: str) -> bool:
    try:
        return ipaddress.ip_address(value).is_global
    except ValueError:
        return False


def validate_public_url(
    url: str,
    *,
    resolve_dns: bool = True,
    resolver: Callable[..., Any] = socket.getaddrinfo,
) -> dict[str, str | bool]:
    """Validate an HTTP(S) URL before any fetch.

    ``kind=unsafe`` is a hard safety failure. ``kind=unresolved`` is an
    evidence failure and therefore goes to review instead of rejection.
    """
    if not isinstance(url, str) or not url.strip() or len(url) > 2048:
        return {"ok": False, "kind": "unsafe", "reason": "URL is empty or too long"}
    if any(ord(character) < 33 for character in url) or "\\" in url:
        return {"ok": False, "kind": "unsafe", "reason": "URL contains whitespace, control characters, or backslashes"}
    try:
        parsed = urlsplit(url.strip())
        port = parsed.port
    except ValueError:
        return {"ok": False, "kind": "unsafe", "reason": "URL has an invalid port"}
    if parsed.scheme.lower() not in {"http", "https"}:
        return {"ok": False, "kind": "unsafe", "reason": "only http(s) URLs are accepted"}
    if parsed.username is not None or parsed.password is not None:
        return {"ok": False, "kind": "unsafe", "reason": "credential-bearing URLs are rejected"}
    hostname = (parsed.hostname or "").rstrip(".").lower()
    if not hostname:
        return {"ok": False, "kind": "unsafe", "reason": "URL hostname is missing"}
    if hostname == "localhost" or hostname.endswith((".localhost", ".local", ".internal")):
        return {"ok": False, "kind": "unsafe", "reason": "local hostnames are rejected"}

    try:
        literal_ip = ipaddress.ip_address(hostname)
    except ValueError:
        literal_ip = None
    if literal_ip is not None:
        if not literal_ip.is_global:
            return {"ok": False, "kind": "unsafe", "reason": "private or reserved IPs are rejected"}
        return {"ok": True, "kind": "public", "reason": "public IP"}

    if not resolve_dns:
        return {"ok": True, "kind": "syntax", "reason": "public hostname syntax"}
    try:
        addresses = {
            item[4][0].split("%", 1)[0]
            for item in resolver(hostname, port or (443 if parsed.scheme == "https" else 80), type=socket.SOCK_STREAM)
        }
    except (OSError, socket.gaierror) as error:
        return {"ok": False, "kind": "unresolved", "reason": f"DNS lookup failed: {str(error)[:120]}"}
    if not addresses:
        return {"ok": False, "kind": "unresolved", "reason": "DNS returned no addresses"}
    if any(not _is_public_ip(address) for address in addresses):
        return {"ok": False, "kind": "unsafe", "reason": "hostname resolves to a private or reserved IP"}
    return {"ok": True, "kind": "public", "reason": "public hostname"}


class SafeRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: N802
        check = validate_public_url(newurl, resolve_dns=True)
        if not check["ok"]:
            raise urllib.error.URLError(f"unsafe redirect: {check['reason']}")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch_meta(url: str) -> dict[str, Any]:
    """Fetch at most 64 KiB after public-address and redirect checks."""
    check = validate_public_url(url, resolve_dns=True)
    if not check["ok"]:
        return {
            "title": "",
            "description": "",
            "reachable": False,
            "error": check["reason"],
            "error_kind": check["kind"],
        }
    try:
        request = urllib.request.Request(
            url,
            headers={"User-Agent": "Mozilla/5.0 (compatible; OpenDesignBot/1.1)"},
        )
        opener = urllib.request.build_opener(SafeRedirectHandler())
        with opener.open(request, timeout=10) as response:
            final_check = validate_public_url(response.geturl(), resolve_dns=True)
            if not final_check["ok"]:
                raise urllib.error.URLError(f"unsafe final URL: {final_check['reason']}")
            markup = response.read(65536).decode("utf-8", errors="ignore")

        title_match = re.search(r"<title[^>]*>([^<]{1,240})</title>", markup, re.I)
        if not title_match:
            title_match = re.search(
                r"<meta[^>]+property=[\"']og:title[\"'][^>]+content=[\"'](.*?)[\"']",
                markup,
                re.I,
            )
        description_match = re.search(
            r"<meta[^>]+name=[\"']description[\"'][^>]+content=[\"'](.*?)[\"']",
            markup,
            re.I,
        ) or re.search(
            r"<meta[^>]+property=[\"']og:description[\"'][^>]+content=[\"'](.*?)[\"']",
            markup,
            re.I,
        )
        return {
            "title": html_lib.unescape(title_match.group(1)).strip()[:120] if title_match else "",
            "description": html_lib.unescape(description_match.group(1)).strip()[:500] if description_match else "",
            "reachable": True,
        }
    except urllib.error.HTTPError as error:
        return {"title": "", "description": "", "reachable": False, "error": f"HTTP {error.code}", "error_kind": "unresolved"}
    except Exception as error:  # Network errors must become reviewable evidence gaps.
        return {"title": "", "description": "", "reachable": False, "error": str(error)[:160], "error_kind": "unresolved"}


def _fallback_signals(evidence: str, *, evidence_state: str = "fail") -> list[dict[str, Any]]:
    signals = []
    for signal_id, label in SIGNAL_DEFINITIONS:
        state = evidence_state if signal_id == "evidence" else "warn"
        score = 0 if signal_id == "evidence" else 50
        signals.append({"id": signal_id, "label": label, "state": state, "score": score, "evidence": [evidence[:MAX_EVIDENCE_LENGTH]]})
    return signals


def fail_closed_decision(reason: str) -> dict[str, Any]:
    bounded = reason.strip()[:MAX_REASON_LENGTH] or "Model evidence unavailable; human review required"
    return {
        "recommendation": "review",
        "confidence": 0,
        "reason": bounded,
        "signals": _fallback_signals(bounded),
    }


def gate_decision(reason: str, *, hard_reject: bool) -> dict[str, Any]:
    signals = _fallback_signals(reason)
    if hard_reject:
        safety = next(signal for signal in signals if signal["id"] == "safety")
        safety.update({"state": "fail", "score": 0})
    return {
        "recommendation": "reject" if hard_reject else "review",
        "confidence": 100 if hard_reject else 0,
        "reason": reason[:MAX_REASON_LENGTH],
        "signals": signals,
    }


def validate_decision_schema(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise DecisionSchemaError("decision must be an object")
    if set(payload) != {"recommendation", "confidence", "reason", "signals"}:
        raise DecisionSchemaError("decision must contain only the four policy fields")
    recommendation = payload.get("recommendation")
    confidence = payload.get("confidence")
    reason = payload.get("reason")
    signals = payload.get("signals")
    if recommendation not in ALLOWED_RECOMMENDATIONS:
        raise DecisionSchemaError("invalid recommendation")
    if isinstance(confidence, bool) or not isinstance(confidence, int) or not 0 <= confidence <= 100:
        raise DecisionSchemaError("confidence must be an integer from 0 to 100")
    if not isinstance(reason, str) or not 1 <= len(reason.strip()) <= MAX_REASON_LENGTH:
        raise DecisionSchemaError("reason must be 1..1000 characters")
    if not isinstance(signals, list) or len(signals) != len(SIGNAL_IDS):
        raise DecisionSchemaError("signals must contain exactly seven entries")

    normalized_by_id: dict[str, dict[str, Any]] = {}
    for signal in signals:
        if not isinstance(signal, dict):
            raise DecisionSchemaError("each signal must be an object")
        if set(signal) != {"id", "label", "state", "score", "evidence"}:
            raise DecisionSchemaError("signals must contain only the five policy fields")
        signal_id = signal.get("id")
        if signal_id not in SIGNAL_ID_SET or signal_id in normalized_by_id:
            raise DecisionSchemaError("signal ids must be the seven unique policy ids")
        label = signal.get("label")
        state = signal.get("state")
        score = signal.get("score")
        evidence = signal.get("evidence")
        if not isinstance(label, str) or not 1 <= len(label.strip()) <= 48:
            raise DecisionSchemaError(f"{signal_id}: label must be 1..48 characters")
        if state not in ALLOWED_STATES:
            raise DecisionSchemaError(f"{signal_id}: invalid state")
        if isinstance(score, bool) or not isinstance(score, int) or not 0 <= score <= 100:
            raise DecisionSchemaError(f"{signal_id}: score must be an integer from 0 to 100")
        if not isinstance(evidence, list) or not 1 <= len(evidence) <= MAX_EVIDENCE_ITEMS:
            raise DecisionSchemaError(f"{signal_id}: evidence must contain 1..3 items")
        if any(not isinstance(item, str) or not 1 <= len(item.strip()) <= MAX_EVIDENCE_LENGTH for item in evidence):
            raise DecisionSchemaError(f"{signal_id}: evidence items must be 1..160 characters")
        normalized_by_id[signal_id] = {
            "id": signal_id,
            "label": label.strip(),
            "state": state,
            "score": score,
            "evidence": [item.strip() for item in evidence],
        }
    if set(normalized_by_id) != SIGNAL_ID_SET:
        raise DecisionSchemaError("signals do not cover the full policy")

    normalized = {
        "recommendation": recommendation,
        "confidence": confidence,
        "reason": reason.strip(),
        "signals": [normalized_by_id[signal_id] for signal_id in SIGNAL_IDS],
    }
    if len(json.dumps(normalized["signals"], ensure_ascii=False).encode("utf-8")) > MAX_SIGNALS_BYTES:
        raise DecisionSchemaError("signals exceed the 15 KB storage boundary")
    hard_failure = any(
        signal["id"] in HARD_REJECT_IDS and signal["state"] == "fail"
        for signal in normalized["signals"]
    )
    evidence_signal = normalized_by_id["evidence"]
    if hard_failure:
        normalized["recommendation"] = "reject"
        normalized["reason"] = f"Hard policy gate failed. {normalized['reason']}"[:MAX_REASON_LENGTH]
    elif evidence_signal["state"] == "fail" or evidence_signal["score"] < EVIDENCE_MIN_SCORE:
        normalized["recommendation"] = "review"
        normalized["reason"] = f"Evidence is insufficient. {normalized['reason']}"[:MAX_REASON_LENGTH]
    return normalized


def _parse_model_json(raw: str) -> Any:
    if len(raw.encode("utf-8")) > MAX_MODEL_RESPONSE_BYTES:
        raise DecisionSchemaError("model response is too large")
    cleaned = re.sub(r"^```(?:json)?\s*", "", raw.strip(), flags=re.I)
    cleaned = re.sub(r"\s*```$", "", cleaned).strip()
    return json.loads(cleaned)


def evaluate_decision(url: str, title: str, description: str) -> dict[str, Any]:
    """Call the configured model once and fail closed to human review."""
    if not AI_KEY:
        return fail_closed_decision("model_unavailable: ANTHROPIC_API_KEY is not configured")
    prompt = EVAL_PROMPT.format(url=url[:2048], title=title[:120], description=description[:500])
    try:
        body = json.dumps(
            {
                "model": AI_MODEL,
                "max_tokens": 1600,
                "thinking": {"type": "disabled"},
                "messages": [{"role": "user", "content": prompt}],
            }
        ).encode("utf-8")
        request = urllib.request.Request(
            f"{AI_BASE}/v1/messages",
            data=body,
            method="POST",
            headers={
                "x-api-key": AI_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.loads(response.read(MAX_MODEL_RESPONSE_BYTES + 1).decode("utf-8"))
        text_blocks = [block.get("text", "") for block in payload.get("content", []) if block.get("type") == "text"]
        if not text_blocks:
            raise DecisionSchemaError("model returned no text block")
        return validate_decision_schema(_parse_model_json(text_blocks[0]))
    except Exception as error:
        return fail_closed_decision(f"model_error: {str(error)[:240]}")


def decision_fingerprint(discovery_id: str, *, policy_version: str, model: str) -> str:
    source = f"{discovery_id}\0{policy_version}\0{model}".encode("utf-8")
    return hashlib.sha256(source).hexdigest()


def _fixture_candidates(path: Path, limit: int) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    candidates = payload.get("discoveries") if isinstance(payload, dict) else payload
    if not isinstance(candidates, list):
        raise ValueError("fixture must be a list or an object with a discoveries list")
    return candidates[:limit]


def _existing_decision(rpc_client: Callable[[str, dict[str, Any]], Any], fingerprint: str) -> bool:
    result = rpc_client(
        "runner_find_curation_decision",
        {"p_token": TOKEN, "p_decision_fingerprint": fingerprint},
    )
    if isinstance(result, list):
        return bool(result)
    return result not in (None, False, "")


def run(args: argparse.Namespace, *, rpc_client=rpc, fetcher=fetch_meta, evaluator=evaluate_decision) -> int:
    fixture_mode = args.fixture is not None
    dry_run = bool(args.dry_run or fixture_mode)
    if args.limit < 1 or args.limit > 500:
        print("✗ --limit 必须在 1..500", file=sys.stderr)
        return 2

    if fixture_mode:
        try:
            pending = _fixture_candidates(args.fixture, args.limit)
        except Exception as error:
            print(f"✗ fixture 无效: {error}", file=sys.stderr)
            return 2
        print("▸ fixture 离线模式（自动 dry-run；不访问 DNS、网站、模型或数据库）")
    else:
        for value, name in ((SB_URL, "SB_URL"), (SB_KEY, "SB_ANON_KEY"), (TOKEN, "RUNNER_TOKEN")):
            if not value:
                print(f"✗ 缺 {name}（写进 ~/.opendesign-runner.env）", file=sys.stderr)
                return 2
        try:
            pending = rpc_client("runner_list_pending", {"p_token": TOKEN, "p_limit": args.limit}) or []
        except Exception as error:
            print(f"✗ 无法读取候选站: {error}", file=sys.stderr)
            return 2

    if not pending:
        print("✓ 无待评估候选站")
        return 0
    print(f"▸ 评估 {len(pending)} 个候选站（上限 {args.limit}；{'dry-run' if dry_run else 'append-only write'}）")
    print("  只生成可审计建议；不发布、不入队，人工终审。\n")

    totals = {"approve": 0, "review": 0, "reject": 0, "duplicate": 0, "error": 0}
    seen_fingerprints: set[str] = set()
    for candidate in pending:
        discovery_id = str(candidate.get("id", "")).strip()
        url = str(candidate.get("url", "")).strip()
        slug = str(candidate.get("slug", ""))[:24]
        title = str(candidate.get("title", ""))[:120]
        model_name = AI_MODEL if AI_KEY else "model-unavailable"
        fingerprint = decision_fingerprint(discovery_id, policy_version=POLICY_VERSION, model=model_name)
        print(f"  [{slug:<24}] {url[:70]}")

        if not discovery_id:
            print("       ERROR · discovery id 缺失")
            totals["error"] += 1
            continue
        if fingerprint in seen_fingerprints:
            print(f"       SKIP · 本批次重复 ({fingerprint[:12]})")
            totals["duplicate"] += 1
            continue
        seen_fingerprints.add(fingerprint)

        if not dry_run:
            try:
                if _existing_decision(rpc_client, fingerprint):
                    print(f"       SKIP · 已存在同 policy/model 决策 ({fingerprint[:12]})")
                    totals["duplicate"] += 1
                    continue
            except Exception as error:
                print(f"       ERROR · 幂等检查失败，拒绝盲写: {str(error)[:160]}")
                totals["error"] += 1
                continue

        syntax_check = validate_public_url(url, resolve_dns=False)
        if not syntax_check["ok"]:
            decision = gate_decision(f"URL safety gate: {syntax_check['reason']}", hard_reject=True)
        else:
            if fixture_mode:
                meta = candidate.get("meta")
                if not isinstance(meta, dict):
                    meta = {"title": title, "description": "", "reachable": False, "error": "fixture has no bounded site evidence", "error_kind": "unresolved"}
            else:
                meta = fetcher(url)
            if not meta.get("reachable"):
                unsafe = meta.get("error_kind") == "unsafe"
                decision = gate_decision(f"Site evidence unavailable: {str(meta.get('error', 'unreachable'))[:240]}", hard_reject=unsafe)
            else:
                full_title = str(meta.get("title") or title)[:120]
                description = str(meta.get("description") or "")[:500]
                if fixture_mode:
                    fixture_decision = candidate.get("modelDecision")
                    try:
                        decision = validate_decision_schema(fixture_decision)
                    except Exception as error:
                        decision = fail_closed_decision(f"fixture_model_error: {str(error)[:240]}")
                else:
                    try:
                        decision = validate_decision_schema(evaluator(url, full_title, description))
                    except Exception as error:
                        decision = fail_closed_decision(f"evaluation_contract_error: {str(error)[:240]}")

        recommendation = decision["recommendation"]
        totals[recommendation] += 1
        if dry_run:
            print(f"       {recommendation.upper()} {decision['confidence']}% · DRY-RUN · {fingerprint[:12]}")
            print(json.dumps({"id": discovery_id, "fingerprint": fingerprint, **decision}, ensure_ascii=False, separators=(",", ":")))
        else:
            try:
                rpc_client(
                    "runner_record_curation_decision",
                    {
                        "p_token": TOKEN,
                        "p_discovery_id": discovery_id,
                        "p_recommendation": recommendation,
                        "p_confidence": decision["confidence"],
                        "p_reason": decision["reason"],
                        "p_policy_version": POLICY_VERSION,
                        "p_model": model_name,
                        "p_signals": decision["signals"],
                        "p_decision_fingerprint": fingerprint,
                    },
                )
                print(f"       {recommendation.upper()} {decision['confidence']}% · 已留痕，等待人工终审 · {fingerprint[:12]}")
            except Exception as error:
                print(f"       ERROR · 建议写入失败: {str(error)[:160]}")
                totals[recommendation] -= 1
                totals["error"] += 1
        if not dry_run:
            time.sleep(0.5)

    print(
        "\n完成：{approve} 建议收录 · {reject} 建议拒绝 · {review} 人工复核 · "
        "{duplicate} 幂等跳过 · {error} 错误".format(**totals)
    )
    print("  → 未发布、未创建任务；人工确认前候选状态不变。")
    return 2 if totals["error"] else 0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate auditable daily curation recommendations")
    parser.add_argument("--dry-run", action="store_true", help="evaluate without writing decision RPCs")
    parser.add_argument("--limit", type=int, default=DEFAULT_BATCH_LIMIT, help="maximum candidates, 1..500")
    parser.add_argument("--fixture", type=Path, help="offline JSON fixture; implies --dry-run and performs no network calls")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    return run(parse_args(argv))


if __name__ == "__main__":
    raise SystemExit(main())
