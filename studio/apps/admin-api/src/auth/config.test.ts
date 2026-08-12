import assert from "node:assert/strict";
import test from "node:test";
import { ConfigurationError, loadAdminApiConfig } from "./config.js";

const valid = (): NodeJS.ProcessEnv => ({
  ADMIN_API_PUBLIC_ORIGIN: "https://admin.opend.example",
  ADMIN_API_GITHUB_CLIENT_ID: "client-id",
  ADMIN_API_GITHUB_CLIENT_SECRET: "client-secret",
  ADMIN_API_GITHUB_ALLOWED_USER_IDS: "123,456",
  ADMIN_API_SIGNING_SECRET: "a-secure-signing-secret-that-is-long-enough",
});

test("loads a strict loopback-only configuration and numeric allowlist", () => {
  const config = loadAdminApiConfig(valid());
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 8790);
  assert.deepEqual([...config.allowedGitHubUserIds], [123, 456]);
});

test("fails closed for absent secrets and malformed authority", () => {
  const missing = valid();
  delete missing.ADMIN_API_SIGNING_SECRET;
  assert.throws(() => loadAdminApiConfig(missing), ConfigurationError);
  assert.throws(() => loadAdminApiConfig({ ...valid(), ADMIN_API_GITHUB_ALLOWED_USER_IDS: "alice" }), /numeric ids/);
  assert.throws(() => loadAdminApiConfig({ ...valid(), ADMIN_API_HOST: "0.0.0.0" }), /127\.0\.0\.1/);
  assert.throws(() => loadAdminApiConfig({ ...valid(), ADMIN_API_PUBLIC_ORIGIN: "http://admin.example" }), /HTTPS origin/);
});
