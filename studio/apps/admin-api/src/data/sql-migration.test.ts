import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../../../../../supabase/migrations/0010_admin_read_api.sql", import.meta.url);
const decisionMigrationUrl = new URL("../../../../../supabase/migrations/0011_curation_decisions.sql", import.meta.url);

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

describe("0011 curation decision SQL draft", () => {
  it("records AI recommendations for human review without enqueuing production work", async () => {
    const sql = await readFile(decisionMigrationUrl, "utf8");
    expect(sql).toMatch(/create table if not exists public\.curation_decisions/iu);
    expect(sql).toMatch(/recommendation in \('approve','review','reject'\)/iu);
    expect(sql).toMatch(/create or replace view opendesign_admin_read\.curation_decisions/iu);
    expect(sql).toMatch(/create unique index if not exists curation_decisions_fingerprint_idx/iu);
    expect(sql).toMatch(/runner_find_curation_decision\(/iu);
    expect(sql).toMatch(/p_decision_fingerprint text/iu);
    expect(sql).toMatch(/on conflict \(decision_fingerprint\)/iu);
    expect(sql).toMatch(/c\.review_status,[\s\S]*c\.final_recommendation/iu);
    expect(sql).toMatch(/create role opendesign_admin_review_writer_role nologin/iu);
    expect(sql).toMatch(/security definer/iu);
    expect(sql).toMatch(/review_curation_decision\(uuid,text,text,text,text\)/iu);
    expect(sql).toMatch(/grant execute on function opendesign_admin_read\.review_curation_decision/iu);
    expect(sql).toMatch(/from public, anon, authenticated, opendesign_admin_read_role, opendesign_admin_audit_writer_role/iu);
    expect(sql).toMatch(/keep the candidate reviewable/iu);
    expect(sql).not.toMatch(/insert into public\.jobs/iu);
    expect(sql).not.toMatch(/\bpassword\s+'/iu);
  });
});
