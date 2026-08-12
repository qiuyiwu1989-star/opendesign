import argparse
import importlib.util
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "auto-evaluate.py"
SPEC = importlib.util.spec_from_file_location("auto_evaluate", SCRIPT)
auto_evaluate = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(auto_evaluate)


def valid_decision(**overrides):
    signals = []
    for signal_id, label in auto_evaluate.SIGNAL_DEFINITIONS:
        signals.append(
            {
                "id": signal_id,
                "label": label,
                "state": "pass",
                "score": 80,
                "evidence": [f"bounded evidence for {signal_id}"],
            }
        )
    payload = {
        "recommendation": "approve",
        "confidence": 82,
        "reason": "Original design work with verifiable public evidence.",
        "signals": signals,
    }
    payload.update(overrides)
    return payload


class DecisionSchemaTests(unittest.TestCase):
    def test_accepts_exact_policy_schema(self):
        result = auto_evaluate.validate_decision_schema(valid_decision())
        self.assertEqual(result["recommendation"], "approve")
        self.assertEqual([signal["id"] for signal in result["signals"]], list(auto_evaluate.SIGNAL_IDS))

    def test_requires_all_seven_unique_signal_ids(self):
        payload = valid_decision()
        payload["signals"][-1]["id"] = "evidence"
        with self.assertRaises(auto_evaluate.DecisionSchemaError):
            auto_evaluate.validate_decision_schema(payload)

    def test_rejects_bad_score_state_and_unbounded_evidence(self):
        for field, value in (("score", 101), ("state", "unknown"), ("evidence", ["x"] * 4)):
            with self.subTest(field=field):
                payload = valid_decision()
                payload["signals"][0][field] = value
                with self.assertRaises(auto_evaluate.DecisionSchemaError):
                    auto_evaluate.validate_decision_schema(payload)

    def test_rejects_unknown_fields(self):
        payload = valid_decision()
        payload["debug"] = "hidden model output"
        with self.assertRaises(auto_evaluate.DecisionSchemaError):
            auto_evaluate.validate_decision_schema(payload)

        payload = valid_decision()
        payload["signals"][0]["url"] = "https://unbounded.example"
        with self.assertRaises(auto_evaluate.DecisionSchemaError):
            auto_evaluate.validate_decision_schema(payload)

    def test_hard_risk_failure_forces_reject(self):
        payload = valid_decision(recommendation="approve")
        spam = next(signal for signal in payload["signals"] if signal["id"] == "spam-risk")
        spam.update({"state": "fail", "score": 0, "evidence": ["affiliate redirect farm"]})
        result = auto_evaluate.validate_decision_schema(payload)
        self.assertEqual(result["recommendation"], "reject")

    def test_insufficient_evidence_forces_review(self):
        payload = valid_decision(recommendation="approve")
        evidence = next(signal for signal in payload["signals"] if signal["id"] == "evidence")
        evidence.update({"state": "warn", "score": 49})
        result = auto_evaluate.validate_decision_schema(payload)
        self.assertEqual(result["recommendation"], "review")

    def test_model_exception_fails_closed(self):
        result = auto_evaluate.fail_closed_decision("model timeout")
        self.assertEqual(result["recommendation"], "review")
        self.assertEqual(result["confidence"], 0)
        auto_evaluate.validate_decision_schema(result)


class PublicUrlTests(unittest.TestCase):
    def test_rejects_credentials_localhost_and_private_ips(self):
        rejected = (
            "https://user:pass@example.com/path",
            "http://localhost:8080",
            "http://127.0.0.1",
            "http://10.2.3.4/path",
            "http://169.254.169.254/latest/meta-data",
            "ftp://example.com/file",
            "https://example.com\\@127.0.0.1/",
            "https://example.com/with a space",
        )
        for url in rejected:
            with self.subTest(url=url):
                result = auto_evaluate.validate_public_url(url, resolve_dns=False)
                self.assertFalse(result["ok"])
                self.assertEqual(result["kind"], "unsafe")

    def test_accepts_public_http_urls_without_dns(self):
        self.assertTrue(auto_evaluate.validate_public_url("https://example.com/design", resolve_dns=False)["ok"])
        self.assertTrue(auto_evaluate.validate_public_url("https://8.8.8.8/", resolve_dns=False)["ok"])

    def test_rejects_hostname_resolving_to_private_ip(self):
        def private_resolver(*_args, **_kwargs):
            return [(2, 1, 6, "", ("192.168.1.2", 443))]

        result = auto_evaluate.validate_public_url("https://example.com", resolver=private_resolver)
        self.assertFalse(result["ok"])
        self.assertEqual(result["kind"], "unsafe")


class RunnerTests(unittest.TestCase):
    def test_fingerprint_is_stable_and_policy_scoped(self):
        first = auto_evaluate.decision_fingerprint("abc", policy_version="v1", model="m1")
        self.assertEqual(first, auto_evaluate.decision_fingerprint("abc", policy_version="v1", model="m1"))
        self.assertNotEqual(first, auto_evaluate.decision_fingerprint("abc", policy_version="v2", model="m1"))

    def test_fixture_implies_dry_run_and_never_calls_network(self):
        fixture = [
            {
                "id": "candidate-1",
                "slug": "example",
                "url": "https://example.com",
                "meta": {"reachable": True, "title": "Example", "description": "Design studio"},
                "modelDecision": valid_decision(),
            }
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "fixture.json"
            path.write_text(json.dumps(fixture), encoding="utf-8")

            def forbidden(*_args, **_kwargs):
                raise AssertionError("fixture mode attempted network or database access")

            args = argparse.Namespace(dry_run=False, fixture=path, limit=10)
            output = io.StringIO()
            with redirect_stdout(output):
                code = auto_evaluate.run(args, rpc_client=forbidden, fetcher=forbidden, evaluator=forbidden)
        self.assertEqual(code, 0)
        self.assertIn("DRY-RUN", output.getvalue())

    def test_duplicate_in_batch_is_skipped(self):
        candidate = {
            "id": "same-id",
            "slug": "example",
            "url": "https://example.com",
            "meta": {"reachable": True, "title": "Example", "description": "Design studio"},
            "modelDecision": valid_decision(),
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "fixture.json"
            path.write_text(json.dumps([candidate, candidate]), encoding="utf-8")
            args = argparse.Namespace(dry_run=False, fixture=path, limit=10)
            output = io.StringIO()
            with redirect_stdout(output):
                code = auto_evaluate.run(args)
        self.assertEqual(code, 0)
        self.assertIn("1 幂等跳过", output.getvalue())

    def test_write_mode_checks_idempotency_before_fetch(self):
        old_values = (auto_evaluate.SB_URL, auto_evaluate.SB_KEY, auto_evaluate.TOKEN)
        auto_evaluate.SB_URL = "https://db.example.com"
        auto_evaluate.SB_KEY = "anon"
        auto_evaluate.TOKEN = "token"
        calls = []

        def fake_rpc(name, params):
            calls.append((name, params))
            if name == "runner_list_pending":
                return [{"id": "known", "slug": "known", "url": "https://example.com"}]
            if name == "runner_find_curation_decision":
                return "existing-decision-id"
            raise AssertionError("duplicate decision should not be written")

        try:
            args = argparse.Namespace(dry_run=False, fixture=None, limit=10)
            output = io.StringIO()
            with redirect_stdout(output):
                code = auto_evaluate.run(args, rpc_client=fake_rpc, fetcher=lambda _url: self.fail("must not fetch duplicate"))
        finally:
            auto_evaluate.SB_URL, auto_evaluate.SB_KEY, auto_evaluate.TOKEN = old_values
        self.assertEqual(code, 0)
        self.assertEqual([name for name, _ in calls], ["runner_list_pending", "runner_find_curation_decision"])


if __name__ == "__main__":
    unittest.main()
