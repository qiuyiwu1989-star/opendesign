import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]


class StudioReleaseContractTest(unittest.TestCase):
    def test_web_uses_studio_base_path(self):
        config = (ROOT / "studio/apps/web/vite.config.ts").read_text(encoding="utf-8")
        self.assertIn('base: "/studio/"', config)

    def test_api_remains_loopback_and_has_no_direct_public_service(self):
        main = (ROOT / "studio/apps/local-api/src/main.ts").read_text(encoding="utf-8")
        service = (ROOT / "deploy/opendesign-studio-api.service.example").read_text(encoding="utf-8")
        self.assertIn('.listen(port, "127.0.0.1"', main)
        self.assertIn("STUDIO_LOCAL_API_PORT=8794", service)
        self.assertIn("EnvironmentFile=/etc/opendesign/studio-api.env", service)
        self.assertIn("STUDIO_PUBLIC_SESSION_SECRET", (ROOT / "studio/apps/local-api/src/main.ts").read_text(encoding="utf-8"))
        self.assertIn("/usr/bin/node /opt/opendesign/studio-current/studio/node_modules/tsx/dist/cli.mjs src/main.ts", service)
        self.assertIn("NoNewPrivileges=true", service)
        self.assertIn("ProtectSystem=strict", service)

    def test_public_preview_keeps_studio_api_bounded(self):
        nginx = (ROOT / "deploy/nginx-studio.conf.example").read_text(encoding="utf-8")
        rate_limit = (
            ROOT / "deploy/nginx-studio-rate-limit.conf.example"
        ).read_text(encoding="utf-8")
        self.assertNotIn("auth_request", nginx)
        self.assertNotIn("/admin-api/", nginx)
        self.assertIn("limit_req zone=opendesign_studio_public", nginx)
        self.assertIn("limit_req_status 429", nginx)
        self.assertIn("client_max_body_size 6m", nginx)
        self.assertIn(
            "limit_req_zone $binary_remote_addr zone=opendesign_studio_public:10m rate=30r/m",
            rate_limit,
        )
        self.assertIn("proxy_pass http://127.0.0.1:8794", nginx)
        self.assertIn("HttpOnly signed cookie", nginx)
        self.assertNotIn("Access-Control-Allow-Origin", nginx)

    def test_release_has_atomic_activation_and_rollback(self):
        prepare = (ROOT / "deploy/prepare-studio-release.sh").read_text(encoding="utf-8")
        activate = (ROOT / "deploy/activate-studio-release.sh").read_text(encoding="utf-8")
        rollback = (ROOT / "deploy/rollback-studio-release.sh").read_text(encoding="utf-8")
        self.assertIn("mv -Tf", activate)
        self.assertIn("studio-previous", activate)
        self.assertIn("studio-previous", rollback)
        self.assertIn("mv -Tf", rollback)
        self.assertIn("npm ci --ignore-scripts", prepare)
        self.assertIn("chmod 0755 node_modules/@esbuild/linux-x64/bin/esbuild", prepare)
        self.assertIn("test -x node_modules/@esbuild/linux-x64/bin/esbuild", prepare)


if __name__ == "__main__":
    unittest.main()
