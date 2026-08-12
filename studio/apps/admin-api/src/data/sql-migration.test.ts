import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../../../../../supabase/migrations/0010_admin_read_api.sql", import.meta.url);

describe("0010 least-privilege SQL draft", () => {
  it("keeps view access independent of base-table grants and supports distinct voter counts", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).not.toMatch(/security_invoker\s*=\s*true/iu);
    expect(sql).not.toMatch(/count\s*\(\s*distinct[^)]*\)\s*over/iu);
    expect(sql).toMatch(/count\s*\(\s*distinct\s+visitor_id\s*\).*group by host, kind/isu);
    expect(sql).toMatch(/with\s*\(security_barrier\s*=\s*true\)/iu);
  });

  it("creates only NOLOGIN roles and grants bounded privileges", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    const executable = sql.split("-- Rollback", 1)[0] ?? sql;
    expect(executable).toMatch(/create role opendesign_admin_read_role nologin/iu);
    expect(executable).toMatch(/create role opendesign_admin_audit_writer_role nologin/iu);
    expect(executable).not.toMatch(/create\s+(?:user|role)\s+\S+\s+(?!nologin)[^;]*\blogin\b/iu);
    expect(executable).not.toMatch(/\bpassword\s+'/iu);
    expect(executable).toMatch(/grant connect on database %I/iu);
    expect(executable).toMatch(/revoke all on schema opendesign_admin_read from public/iu);
    expect(executable).not.toMatch(/app_config|admin_list_|runner_/iu);
    expect(executable).toMatch(/grant select on opendesign_admin_read\.submissions/iu);
    expect(executable).toMatch(/grant execute on function opendesign_admin_read\.write_audit_event/iu);
  });
});
