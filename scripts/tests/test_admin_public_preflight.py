from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import unittest


SCRIPT = Path(__file__).parents[1] / "admin-public-preflight.py"
SPEC = importlib.util.spec_from_file_location("admin_public_preflight", SCRIPT)
assert SPEC and SPEC.loader
preflight = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = preflight
SPEC.loader.exec_module(preflight)


class FakeFetcher:
    def __init__(self, responses):
        self.responses = responses
        self.paths = []

    def __call__(self, path):
        self.paths.append(path)
        return self.responses[path]


def response(status=200, body=b"", **headers):
    return preflight.Response(
        status=status,
        headers={key.replace("_", "-").lower(): value for key, value in headers.items()},
        body=body,
    )


def healthy_responses():
    manifest = (
        b'{"schema":"opendesign.pack-manifest.v1","packIds":["alpha","beta"],'
        b'"provenance":{"source":"packs-index.json","generatedAt":"2026-08-13T00:00:00Z",'
        b'"sourceCount":2}}'
    )
    return {
        "/admin.html": response(302, location="https://opendesign.cc/admin/"),
        "/admin/": response(
            body=b'<script type="module" src="/admin/assets/index-good.js"></script>',
            content_security_policy="default-src 'self'; frame-ancestors 'none'",
            x_frame_options="DENY",
            cache_control="no-cache",
        ),
        "/admin/assets/index-good.js": response(
            body=(
                b'const review="/admin-api/v1/decisions/review";'
                b'const packs="/admin/pack-manifest.json";'
            )
        ),
        "/admin/pack-manifest.json": response(body=manifest),
        "/admin-api/v1/health/live": response(),
        "/admin-api/v1/health/ready": response(),
        "/admin-api/v1/session": response(body=b'{"authenticated":false}'),
        "/admin-api/v1/operations": response(401),
        "/admin-api/v1/sync": response(401),
        "/admin-api/v1/decisions/review": response(403),
    }


class PublicPreflightTests(unittest.TestCase):
    def test_healthy_release_passes_with_get_only_evidence(self):
        fetcher = FakeFetcher(healthy_responses())

        checks = preflight.evaluate_public_preflight(fetcher, certificate_days=45)

        self.assertTrue(all(check.passed for check in checks))
        self.assertEqual(len(checks), 17)
        self.assertEqual(fetcher.paths.count("/admin-api/v1/decisions/review"), 1)

    def test_partial_upgrade_reports_release_blockers(self):
        responses = healthy_responses()
        responses["/admin/"] = response(
            body=b'<script src="/admin/assets/index-old.js"></script>',
            content_security_policy="default-src 'self' 'unsafe-inline'; frame-ancestors 'self'",
            x_frame_options="SAMEORIGIN",
        )
        responses["/admin/assets/index-old.js"] = response(
            body=b'const packs="/pack-manifest.json";'
        )
        responses["/admin-api/v1/decisions/review"] = response(404)

        checks = preflight.evaluate_public_preflight(FakeFetcher(responses), certificate_days=12)
        failures = {check.name for check in checks if not check.passed}

        self.assertEqual(
            failures,
            {
                "admin CSP",
                "admin frame protection",
                "admin cache policy",
                "human review UI contract",
                "pack manifest bundle path",
                "human review API route",
                "TLS renewal window",
            },
        )

    def test_manifest_count_must_match_membership(self):
        responses = healthy_responses()
        responses["/admin/pack-manifest.json"] = response(
            body=(
                b'{"schema":"opendesign.pack-manifest.v1","packIds":["alpha","beta"],'
                b'"provenance":{"source":"packs-index.json",'
                b'"generatedAt":"2026-08-13T00:00:00Z","sourceCount":3}}'
            )
        )

        checks = preflight.evaluate_public_preflight(FakeFetcher(responses), certificate_days=45)
        manifest_check = next(check for check in checks if check.name == "compact pack manifest")

        self.assertFalse(manifest_check.passed)


if __name__ == "__main__":
    unittest.main()
