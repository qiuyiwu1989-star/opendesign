#!/usr/bin/env python3
"""Read-only public preflight for the OpenDesign admin control plane.

The command only issues HTTPS GET requests and performs a TLS handshake. It
does not authenticate, submit decisions, or mutate production state.
"""

from __future__ import annotations

import argparse
import http.client
import json
import re
import socket
import ssl
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable, Mapping
from urllib.parse import urlparse


DEFAULT_BASE_URL = "https://opendesign.cc"
MIN_CERTIFICATE_DAYS = 21
MAX_BODY_BYTES = 2 * 1024 * 1024


@dataclass(frozen=True)
class Response:
    status: int
    headers: Mapping[str, str]
    body: bytes


@dataclass(frozen=True)
class Check:
    name: str
    passed: bool
    detail: str


Fetcher = Callable[[str], Response]


def _header(response: Response, name: str) -> str:
    return response.headers.get(name.lower(), "")


def _json(response: Response) -> object | None:
    try:
        return json.loads(response.body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None


def _find_admin_bundle(admin_html: bytes) -> str | None:
    match = re.search(rb'<script[^>]+src="(/admin/assets/[^"?]+\.js)', admin_html)
    return match.group(1).decode("ascii") if match else None


def evaluate_public_preflight(fetch: Fetcher, certificate_days: int) -> list[Check]:
    """Evaluate public release evidence using an injectable GET-only fetcher."""

    checks: list[Check] = []

    def add(name: str, passed: bool, detail: str) -> None:
        checks.append(Check(name=name, passed=passed, detail=detail))

    admin_redirect = fetch("/admin.html")
    redirect_location = _header(admin_redirect, "location")
    add(
        "legacy admin redirect",
        admin_redirect.status in {301, 302, 307, 308}
        and urlparse(redirect_location).path == "/admin/",
        f"status={admin_redirect.status} location={redirect_location or '-'}",
    )

    admin = fetch("/admin/")
    add("admin shell", admin.status == 200, f"status={admin.status}")
    csp = _header(admin, "content-security-policy")
    add(
        "admin CSP",
        "frame-ancestors 'none'" in csp and "'unsafe-inline'" not in csp,
        "strict" if "frame-ancestors 'none'" in csp and "'unsafe-inline'" not in csp else "legacy-or-weak",
    )
    x_frame_options = _header(admin, "x-frame-options")
    add(
        "admin frame protection",
        x_frame_options.upper() == "DENY",
        x_frame_options or "missing",
    )
    cache_control = _header(admin, "cache-control").lower()
    add(
        "admin cache policy",
        "no-cache" in cache_control or "no-store" in cache_control,
        cache_control or "missing",
    )

    bundle_path = _find_admin_bundle(admin.body)
    add("admin bundle discovery", bundle_path is not None, bundle_path or "missing")
    if bundle_path:
        bundle = fetch(bundle_path)
        add("admin bundle", bundle.status == 200, f"status={bundle.status}")
        add(
            "human review UI contract",
            b"/admin-api/v1/decisions/review" in bundle.body,
            "present" if b"/admin-api/v1/decisions/review" in bundle.body else "missing",
        )
        correct_manifest_path = b"/admin/pack-manifest.json" in bundle.body
        wrong_manifest_path = b'"/pack-manifest.json"' in bundle.body
        add(
            "pack manifest bundle path",
            correct_manifest_path and not wrong_manifest_path,
            "admin-scoped" if correct_manifest_path and not wrong_manifest_path else "root-or-missing",
        )

    manifest = fetch("/admin/pack-manifest.json")
    manifest_data = _json(manifest)
    pack_ids = manifest_data.get("packIds") if isinstance(manifest_data, dict) else None
    provenance = manifest_data.get("provenance") if isinstance(manifest_data, dict) else None
    source_count = provenance.get("sourceCount") if isinstance(provenance, dict) else None
    manifest_valid = (
        manifest.status == 200
        and isinstance(pack_ids, list)
        and len(pack_ids) > 0
        and manifest_data.get("schema") == "opendesign.pack-manifest.v1"
        and provenance.get("source") == "packs-index.json"
        and isinstance(source_count, int)
        and source_count == len(pack_ids)
    )
    add(
        "compact pack manifest",
        manifest_valid,
        f"status={manifest.status} packs={len(pack_ids) if isinstance(pack_ids, list) else 0}",
    )

    for path, label in (
        ("/admin-api/v1/health/live", "API live"),
        ("/admin-api/v1/health/ready", "API ready"),
    ):
        response = fetch(path)
        add(label, response.status == 200, f"status={response.status}")

    session = fetch("/admin-api/v1/session")
    session_data = _json(session)
    add(
        "anonymous session boundary",
        session.status == 200
        and isinstance(session_data, dict)
        and session_data.get("authenticated") is False,
        f"status={session.status}",
    )

    for path, label in (
        ("/admin-api/v1/operations", "operations auth boundary"),
        ("/admin-api/v1/sync", "sync auth boundary"),
    ):
        response = fetch(path)
        add(label, response.status == 401, f"status={response.status}")

    # The release nginx contract reserves this exact path for POST. A GET must
    # be rejected by that location (403/405), not fall through to the 404 sink.
    review_route = fetch("/admin-api/v1/decisions/review")
    add(
        "human review API route",
        review_route.status in {401, 403, 405},
        f"GET status={review_route.status}",
    )

    add(
        "TLS renewal window",
        certificate_days >= MIN_CERTIFICATE_DAYS,
        f"days_remaining={certificate_days} required={MIN_CERTIFICATE_DAYS}",
    )
    return checks


def create_https_fetcher(base_url: str, timeout: float) -> Fetcher:
    parsed = urlparse(base_url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.path not in {"", "/"}:
        raise ValueError("base URL must be an HTTPS origin without a path")
    port = parsed.port or 443
    context = ssl.create_default_context()

    def fetch(path: str) -> Response:
        if not path.startswith("/") or "\n" in path or "\r" in path:
            raise ValueError("preflight paths must be origin-relative")
        connection = http.client.HTTPSConnection(
            parsed.hostname,
            port=port,
            timeout=timeout,
            context=context,
        )
        try:
            connection.request(
                "GET",
                path,
                headers={
                    "Accept": "application/json,text/html,*/*",
                    "User-Agent": "OpenDesign-Public-Preflight/1.0",
                },
            )
            response = connection.getresponse()
            body = response.read(MAX_BODY_BYTES + 1)
            if len(body) > MAX_BODY_BYTES:
                raise RuntimeError(f"response exceeded {MAX_BODY_BYTES} bytes: {path}")
            headers = {name.lower(): value for name, value in response.getheaders()}
            return Response(status=response.status, headers=headers, body=body)
        finally:
            connection.close()

    return fetch


def certificate_days_remaining(base_url: str, timeout: float) -> int:
    parsed = urlparse(base_url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError("base URL must use HTTPS")
    context = ssl.create_default_context()
    with socket.create_connection((parsed.hostname, parsed.port or 443), timeout=timeout) as raw:
        with context.wrap_socket(raw, server_hostname=parsed.hostname) as secure:
            not_after = secure.getpeercert().get("notAfter")
    if not isinstance(not_after, str):
        raise RuntimeError("TLS certificate did not expose notAfter")
    expiry = datetime.strptime(not_after, "%b %d %H:%M:%S %Y %Z").replace(tzinfo=timezone.utc)
    return max(0, int((expiry - datetime.now(timezone.utc)).total_seconds() // 86400))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--timeout", type=float, default=10.0)
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args(argv)

    try:
        fetch = create_https_fetcher(args.base_url, args.timeout)
        days = certificate_days_remaining(args.base_url, args.timeout)
        checks = evaluate_public_preflight(fetch, days)
    except (OSError, RuntimeError, ValueError, http.client.HTTPException) as error:
        print(f"preflight collection failed: {error}", file=sys.stderr)
        return 2

    failed = [check for check in checks if not check.passed]
    if not args.quiet:
        for check in checks:
            marker = "PASS" if check.passed else "FAIL"
            print(f"[{marker}] {check.name}: {check.detail}")
        print(f"summary: {len(checks) - len(failed)}/{len(checks)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
