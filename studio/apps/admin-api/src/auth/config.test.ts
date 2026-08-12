import assert from "node:assert/strict";
import test from "node:test";
import { ConfigurationError, loadAdminApiConfig } from "./config.js";

const valid = (): NodeJS.ProcessEnv => ({
  ADMIN_API_PUBLIC_ORIGIN: "https://admin.opend.example",
  ADMIN_API_ADMIN_USERNAME: "admin",
  ADMIN_API_PASSWORD_HASH: "scrypt$32768$8$1$BwcHBwcHBwcHBwcHBwcHBw$BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc",
  ADMIN_API_SIGNING_SECRET: "a-secure-signing-secret-that-is-long-enough",
});

test("loads a strict loopback-only local administrator configuration", () => {
  const config = loadAdminApiConfig(valid());
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 8790);
  assert.equal(config.adminUsername, "admin");
});

test("fails closed for absent secrets and malformed authority", () => {
  const missing = valid();
  delete missing.ADMIN_API_SIGNING_SECRET;
  assert.throws(() => loadAdminApiConfig(missing), ConfigurationError);
  assert.throws(() => loadAdminApiConfig({ ...valid(), ADMIN_API_ADMIN_USERNAME: "root" }), /must be admin/);
  assert.throws(() => loadAdminApiConfig({ ...valid(), ADMIN_API_HOST: "0.0.0.0" }), /127\.0\.0\.1/);
  assert.throws(() => loadAdminApiConfig({ ...valid(), ADMIN_API_PUBLIC_ORIGIN: "http://admin.example" }), /HTTPS origin/);
});

test("requires the production read and audit database settings as one unit", () => {
  assert.throws(() => loadAdminApiConfig({ ...valid(), ADMIN_DATABASE_URL: "postgresql://read-only.invalid/db" }), /configured together/);
  assert.throws(() => loadAdminApiConfig({
    ...valid(),
    ADMIN_DATABASE_URL: "postgresql://read-only.invalid/db",
    ADMIN_AUDIT_DATABASE_URL: "postgresql://audit-only.invalid/db",
    ADMIN_API_AUDIT_HASH_KEY: "short",
  }), /at least 32 bytes/);
  const config = loadAdminApiConfig({
    ...valid(),
    ADMIN_DATABASE_URL: "postgresql://read-only.invalid/db",
    ADMIN_AUDIT_DATABASE_URL: "postgresql://audit-only.invalid/db",
    ADMIN_API_AUDIT_HASH_KEY: "audit-hash-key-that-is-at-least-32-bytes",
  });
  assert.equal(config.databaseUrl, "postgresql://read-only.invalid/db");
  assert.equal(config.auditDatabaseUrl, "postgresql://audit-only.invalid/db");
});

test("requires the full audited database trio before enabling the separate review connection", () => {
  assert.throws(() => loadAdminApiConfig({ ...valid(), ADMIN_REVIEW_DATABASE_URL: "postgresql://review-only.invalid/db" }), /requires the read and audit/);
  const config = loadAdminApiConfig({
    ...valid(),
    ADMIN_DATABASE_URL: "postgresql://read-only.invalid/db",
    ADMIN_AUDIT_DATABASE_URL: "postgresql://audit-only.invalid/db",
    ADMIN_API_AUDIT_HASH_KEY: "audit-hash-key-that-is-at-least-32-bytes",
    ADMIN_REVIEW_DATABASE_URL: "postgresql://review-only.invalid/db",
  });
  assert.equal(config.reviewDatabaseUrl, "postgresql://review-only.invalid/db");
  assert.equal(config.databaseUrl, "postgresql://read-only.invalid/db");
  assert.equal(config.auditDatabaseUrl, "postgresql://audit-only.invalid/db");
});
