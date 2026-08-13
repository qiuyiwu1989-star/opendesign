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
        self.assertIn("/usr/bin/node /opt/opendesign/studio-current/studio/node_modules/tsx/dist/cli.mjs src/main.ts", service)
        self.assertIn("NoNewPrivileges=true", service)
        self.assertIn("ProtectSystem=strict", service)

    def test_nginx_requires_admin_session_before_studio_api(self):
        nginx = (ROOT / "deploy/nginx-studio.conf.example").read_text(encoding="utf-8")
        self.assertIn("auth_request /studio-auth-check", nginx)
        self.assertIn("/admin-api/v1/operations", nginx)
        self.assertNotIn("/admin-api/v1/session", nginx)
        self.assertIn("proxy_pass http://127.0.0.1:8794", nginx)
        self.assertNotIn("Access-Control-Allow-Origin", nginx)

    def test_release_has_atomic_activation_and_rollback(self):
        activate = (ROOT / "deploy/activate-studio-release.sh").read_text(encoding="utf-8")
        rollback = (ROOT / "deploy/rollback-studio-release.sh").read_text(encoding="utf-8")
        self.assertIn("mv -Tf", activate)
        self.assertIn("studio-previous", activate)
        self.assertIn("studio-previous", rollback)
        self.assertIn("mv -Tf", rollback)


if __name__ == "__main__":
    unittest.main()
