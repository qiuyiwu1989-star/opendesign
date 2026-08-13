import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const bootstrapUrl = new URL("../../../../../deploy/bootstrap-library-admin-production.sh", import.meta.url);
const rollbackUrl = new URL("../../../../../deploy/rollback-library-admin-capabilities.sql", import.meta.url);
const builderUrl = new URL("../../../../../scripts/build-library-admin-release.sh", import.meta.url);
const activationUrl = new URL("../../../../../deploy/activate-library-admin-release.sh", import.meta.url);
const releaseRollbackUrl = new URL("../../../../../deploy/rollback-library-admin-release.sh", import.meta.url);
const nginxUrl = new URL("../../../../../deploy/nginx-library-admin-api.conf.example", import.meta.url);
const reviewUpgradeUrl = new URL("../../../../../deploy/prepare-library-admin-review-upgrade.sh", import.meta.url);
const productionPreflightUrl = new URL("../../../../../deploy/preflight-library-admin-production.sh", import.meta.url);

describe("Admin API deployment contract", () => {
  it("keeps the production bootstrap syntactically valid and provisions three isolated logins", async () => {
    const syntax = spawnSync("bash", ["-n", bootstrapUrl.pathname], { encoding: "utf8" });
    expect(syntax.status, syntax.stderr).toBe(0);
    const script = await readFile(bootstrapUrl, "utf8");
    for (const capability of ["read", "audit", "review"]) {
      expect(script).toContain(`opendesign_admin_api_${capability}_login`);
      expect(script).toContain(`${capability}_password`);
    }
    expect(script).toContain("ADMIN_REVIEW_DATABASE_URL=");
    expect(script).toMatch(/verify_archive "\$\{api_archive\}"/u);
    expect(script).toMatch(/release target already exists/iu);
    expect(script).not.toMatch(/npm install/iu);
    expect(script).toMatch(/REVOKE opendesign_admin_read_role, opendesign_admin_audit_writer_role FROM opendesign_admin_api_review_login/iu);
    expect(script).toMatch(/review login unexpectedly read decision rows/iu);
    expect(script).toMatch(/review login unexpectedly executed the audit writer/iu);
    expect(script).toMatch(/no public pointer was changed/iu);
    expect(script).not.toMatch(/ln -sfn "\$\{release_root\}" \/opt\/opendesign\/current/iu);
    expect(script).not.toMatch(/echo[^\n]*(?:read|audit|review)_password/iu);
    expect(script).toMatch(/deployment login already exists; use the reviewed upgrade path/iu);
    expect(script).not.toMatch(/ALTER ROLE opendesign_admin_api_(?:read|audit|review)_login PASSWORD/iu);
  });

  it("adds review capability to an existing install without rotating active credentials", async () => {
    const syntax = spawnSync("bash", ["-n", reviewUpgradeUrl.pathname], { encoding: "utf8" });
    expect(syntax.status, syntax.stderr).toBe(0);
    const script = await readFile(reviewUpgradeUrl, "utf8");
    expect(script).toContain("ADMIN_REVIEW_DATABASE_URL=");
    expect(script).toMatch(/refusing password rotation/iu);
    expect(script).toMatch(/without changing current read\/audit credentials/iu);
    expect(script).not.toMatch(/ALTER ROLE opendesign_admin_api_(?:read|audit)_login/iu);
  });

  it("separates preparation from atomic activation and reversible file-pointer rollback", async () => {
    for (const file of [activationUrl, releaseRollbackUrl]) {
      const syntax = spawnSync("bash", ["-n", file.pathname], { encoding: "utf8" });
      expect(syntax.status, syntax.stderr).toBe(0);
    }
    const activation = await readFile(activationUrl, "utf8");
    const rollback = await readFile(releaseRollbackUrl, "utf8");
    expect(activation).toContain("admin.previous");
    expect(activation).toMatch(/mv -Tf "\$\{current\}\.next" "\$\{current\}"/u);
    expect(activation).toMatch(/service restart and nginx reload remain separate approved actions/iu);
    expect(rollback).toContain("rollback_pointer");
    expect(rollback).toMatch(/unlink "\$\{current\}"/u);
    expect(rollback).toMatch(/first-release symlink was removed/iu);
    expect(rollback).toMatch(/service restart remains a separate approved action/iu);
  });

  it("routes the public legacy admin entry to the atomically switched Control Room", async () => {
    const nginx = await readFile(nginxUrl, "utf8");
    expect(nginx).toMatch(/location = \/admin\.html\s*\{\s*return 302 \/admin\/;/iu);
    expect(nginx).toMatch(/location \^~ \/admin\/\s*\{/iu);
    expect(nginx).toContain("/admin/index.html");
    expect(nginx).toMatch(/Content-Security-Policy[^\n]*default-src 'self'/iu);
    expect(nginx).toMatch(/Strict-Transport-Security/iu);
  });

  it("builds an immutable checksummed artifact before production", async () => {
    const syntax = spawnSync("bash", ["-n", builderUrl.pathname], { encoding: "utf8" });
    expect(syntax.status, syntax.stderr).toBe(0);
    const script = await readFile(builderUrl, "utf8");
    expect(script).toMatch(/release builds require a clean worktree/iu);
    expect(script).toMatch(/output directory must be absolute/iu);
    expect(script).toContain("npm ci --ignore-scripts");
    expect(script).toContain("npm run test:release");
    expect(script).toContain("npm install --omit=dev --ignore-scripts");
    expect(script).toContain("release-manifest.json");
    expect(script).toContain("opendesign.library-admin-release.v1");
  });

  it("keeps rollback scoped to capabilities and preserves the public journal", async () => {
    const sql = await readFile(rollbackUrl, "utf8");
    expect(sql).toMatch(/revoke opendesign_admin_review_writer_role from opendesign_admin_api_review_login/iu);
    expect(sql).toMatch(/drop schema if exists opendesign_admin_read cascade/iu);
    expect(sql).not.toMatch(/drop\s+(?:table|function)[^;]*(?:curation_decisions|runner_)/iu);
    expect(sql).not.toMatch(/drop role if exists opendesign_admin_api_\w+_login/iu);
  });

  it("keeps the server preflight read-only and secret-safe", async () => {
    const syntax = spawnSync("bash", ["-n", productionPreflightUrl.pathname], { encoding: "utf8" });
    expect(syntax.status, syntax.stderr).toBe(0);
    const script = await readFile(productionPreflightUrl, "utf8");
    expect(script).toContain("READ-ONLY SERVER PREFLIGHT");
    expect(script).toContain("show server_version");
    expect(script).toContain("ADMIN_REVIEW_DATABASE_URL");
    expect(script).toContain("opendesign_admin_api_review_login");
    expect(script).toContain("certbot renewal timer");
    expect(script).not.toMatch(/systemctl\s+(?:start|restart|reload|enable|disable)/iu);
    expect(script).not.toMatch(/(?:insert|update|delete|alter|create|drop|grant|revoke)\s+/iu);
    expect(script).not.toMatch(/source\s+"?\$\{environment_file\}/u);
    expect(script).not.toMatch(/cat\s+"?\$\{environment_file\}/u);
  });
});
