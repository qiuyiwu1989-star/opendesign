import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import type { AdminApiConfig, LocalPasswordVerifier } from "../auth/index.js";
import { createAdminApiServer } from "../server.js";
import { DecisionReviewRepository } from "../data/decision-review-repository.js";
import type { DatabaseClient, DatabaseQuery } from "../data/types.js";

const migration = (name: string) => new URL(`../../../../../supabase/migrations/${name}`, import.meta.url);
const baselineSchema = new URL("../../../../../supabase/schema.sql", import.meta.url);
const rollbackScript = new URL("../../../../../deploy/rollback-library-admin-capabilities.sql", import.meta.url);
const migrations = [
  "0002_sync_codes.sql",
  "0003_submissions.sql",
  "0004_pack_requests.sql",
  "0005_jobs.sql",
  "0006_discoveries.sql",
  "0007_auto_system.sql",
  "0008_run_logs.sql",
  "0009_lockdown_anon_writes.sql",
  "0010_admin_read_api.sql",
  "0011_curation_decisions.sql",
] as const;

const signals = [
  { id: "design-value", label: "设计参考价值", state: "pass", score: 80, evidence: ["公开案例"] },
  { id: "originality", label: "原创性", state: "warn", score: 60, evidence: ["待核作者"] },
  { id: "utility", label: "可复用价值", state: "pass", score: 75, evidence: ["版式可复用"] },
  { id: "evidence", label: "证据完整度", state: "warn", score: 55, evidence: ["首页证据"] },
  { id: "spam-risk", label: "垃圾风险", state: "pass", score: 95, evidence: ["无垃圾"] },
  { id: "ad-risk", label: "广告风险", state: "pass", score: 95, evidence: ["无广告"] },
  { id: "safety", label: "安全性", state: "pass", score: 95, evidence: ["HTTPS"] },
];

async function applyAll(database: PGlite): Promise<void> {
  await database.exec("create role anon nologin; create role authenticated nologin;");
  await database.exec(await readFile(baselineSchema, "utf8"));
  for (const name of migrations) await database.exec(await readFile(migration(name), "utf8"));
}

async function applyThrough0010(database: PGlite): Promise<void> {
  await database.exec("create role anon nologin; create role authenticated nologin;");
  await database.exec(await readFile(baselineSchema, "utf8"));
  for (const name of migrations.slice(0, -1)) await database.exec(await readFile(migration(name), "utf8"));
}

function restrictedClient(database: PGlite, role: string): DatabaseClient {
  return {
    async query<T>(query: DatabaseQuery<T>) {
      if (query.signal?.aborted) throw new Error("database query aborted");
      await database.exec(`set role ${role}`);
      try {
        const result = await database.query<T>(query.text, [...query.values]);
        if (result.rows.length > query.maxRows) throw new Error("database returned more rows than allowed");
        return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
      } finally {
        await database.exec("reset role");
      }
    },
  };
}

const apiConfig: AdminApiConfig = {
  publicOrigin: "https://admin.example",
  adminUsername: "admin",
  passwordHash: "injected-verifier",
  signingSecret: "release-candidate-signing-secret-32-bytes",
  host: "127.0.0.1",
  port: 8790,
  sessionTtlSeconds: 900,
};
const passwordVerifier: LocalPasswordVerifier = { verify: async (password) => password === "fixture-password" };

describe("baseline + 0002–0011 PostgreSQL release candidate", () => {
  it("reapplies 0011 safely on the embedded PostgreSQL semantic baseline", async () => {
    const database = await PGlite.create({ dataDir: "memory://", extensions: { pgcrypto } });
    try {
      await applyThrough0010(database);
      const decisionSql = await readFile(migration("0011_curation_decisions.sql"), "utf8");
      await database.exec(decisionSql);
      await database.exec(decisionSql);
      const version = await database.query<{ server_version_num: string }>("show server_version_num");
      expect(Number(version.rows[0]!.server_version_num)).toBeGreaterThanOrEqual(15_00_00);
      const objects = await database.query<{ tables: number; review_functions: number }>(`
        select
          (select count(*)::int from pg_class where relname='curation_decisions' and relkind='r') tables,
          (select count(*)::int from pg_proc where proname='review_curation_decision') review_functions
      `);
      expect(objects.rows[0]).toEqual({ tables: 1, review_functions: 1 });
    } finally {
      await database.close();
    }
  });

  it("executes the full migration chain and keeps the three group roles mutually bounded", async () => {
    const database = await PGlite.create({ dataDir: "memory://", extensions: { pgcrypto } });
    try {
      await applyAll(database);
      const roles = await database.query<{ rolname: string; rolcanlogin: boolean }>(`
        select rolname, rolcanlogin from pg_roles
        where rolname in (
          'opendesign_admin_read_role',
          'opendesign_admin_audit_writer_role',
          'opendesign_admin_review_writer_role'
        ) order by rolname
      `);
      expect(roles.rows).toHaveLength(3);
      expect(roles.rows.every((role) => role.rolcanlogin === false)).toBe(true);

      const privileges = await database.query<{ read_view: boolean; write_audit: boolean; review_decision: boolean }>(`
        select
          has_table_privilege('opendesign_admin_read_role', 'opendesign_admin_read.discoveries', 'select') read_view,
          has_function_privilege('opendesign_admin_read_role', 'opendesign_admin_read.write_audit_event(text,timestamptz,text,text,text,text,integer,text,jsonb)', 'execute') write_audit,
          has_function_privilege('opendesign_admin_read_role', 'opendesign_admin_read.review_curation_decision(uuid,text,text,text,text)', 'execute') review_decision
        union all select
          has_table_privilege('opendesign_admin_audit_writer_role', 'opendesign_admin_read.discoveries', 'select'),
          has_function_privilege('opendesign_admin_audit_writer_role', 'opendesign_admin_read.write_audit_event(text,timestamptz,text,text,text,text,integer,text,jsonb)', 'execute'),
          has_function_privilege('opendesign_admin_audit_writer_role', 'opendesign_admin_read.review_curation_decision(uuid,text,text,text,text)', 'execute')
        union all select
          has_table_privilege('opendesign_admin_review_writer_role', 'opendesign_admin_read.discoveries', 'select'),
          has_function_privilege('opendesign_admin_review_writer_role', 'opendesign_admin_read.write_audit_event(text,timestamptz,text,text,text,text,integer,text,jsonb)', 'execute'),
          has_function_privilege('opendesign_admin_review_writer_role', 'opendesign_admin_read.review_curation_decision(uuid,text,text,text,text)', 'execute')
      `);
      expect(privileges.rows).toEqual([
        { read_view: true, write_audit: false, review_decision: false },
        { read_view: false, write_audit: true, review_decision: false },
        { read_view: false, write_audit: false, review_decision: true },
      ]);

      const baseTable = await database.query<{ can_read: boolean; can_write: boolean }>(`
        select
          has_table_privilege('opendesign_admin_review_writer_role', 'public.curation_decisions', 'select') can_read,
          has_table_privilege('opendesign_admin_review_writer_role', 'public.curation_decisions', 'update') can_write
      `);
      expect(baseTable.rows[0]).toEqual({ can_read: false, can_write: false });
    } finally {
      await database.close();
    }
  });

  it("records one idempotent AI recommendation and preserves it across terminal review", async () => {
    const database = await PGlite.create({ dataDir: "memory://", extensions: { pgcrypto } });
    try {
      await applyAll(database);
      const discovery = await database.query<{ id: string }>(`
        insert into public.discoveries (url, host, slug, title, source, score)
        values ('https://example.com', 'example.com', 'example', 'Example', 'fixture', 20)
        returning id
      `);
      const discoveryId = discovery.rows[0]!.id;
      const runner = await database.query<{ value: string }>("select value from public.app_config where key='runner_token'");
      const token = runner.rows[0]!.value;
      const fingerprint = "a".repeat(64);
      const params = [token, discoveryId, "reject", 92, "广告风险证据", "opendesign-curation-v1.1", "fixture-model", JSON.stringify(signals), fingerprint];
      const first = await database.query<{ id: string }>(`
        select public.runner_record_curation_decision($1,$2::uuid,$3,$4::int,$5,$6,$7,$8::jsonb,$9) id
      `, params);
      const second = await database.query<{ id: string }>(`
        select public.runner_record_curation_decision($1,$2::uuid,$3,$4::int,$5,$6,$7,$8::jsonb,$9) id
      `, params);
      expect(second.rows[0]!.id).toBe(first.rows[0]!.id);
      const count = await database.query<{ count: number }>("select count(*)::int count from public.curation_decisions");
      expect(count.rows[0]!.count).toBe(1);

      const reviewed = await database.query<{ outcome: string; review_status: string; recommendation: string }>(`
        select outcome, review_status, recommendation
        from opendesign_admin_read.review_curation_decision($1::uuid,$2,$3,$4,$5)
      `, [first.rows[0]!.id, "admin", "override", "approve", "人工核对原创证据后覆盖"]);
      expect(reviewed.rows[0]).toEqual({ outcome: "reviewed", review_status: "overridden", recommendation: "approve" });
      const record = await database.query<{ recommendation: string; final_recommendation: string; review_status: string }>(`
        select recommendation, final_recommendation, review_status from public.curation_decisions where id=$1
      `, [first.rows[0]!.id]);
      expect(record.rows[0]).toEqual({ recommendation: "reject", final_recommendation: "approve", review_status: "overridden" });
      const repeated = await database.query<{ outcome: string }>(`
        select outcome from opendesign_admin_read.review_curation_decision($1::uuid,$2,$3,$4,$5)
      `, [first.rows[0]!.id, "admin", "confirm", null, "不允许重复复核"]);
      expect(repeated.rows[0]!.outcome).toBe("already_reviewed");
    } finally {
      await database.close();
    }
  });

  it("completes login and terminal review through the real HTTP and SQL boundaries", async () => {
    const database = await PGlite.create({ dataDir: "memory://", extensions: { pgcrypto } });
    try {
      await applyAll(database);
      const discovery = await database.query<{ id: string }>(`
        insert into public.discoveries (url, host, slug, title, source, score)
        values ('https://http.example', 'http.example', 'http-example', 'HTTP Example', 'fixture', 18)
        returning id
      `);
      const runner = await database.query<{ value: string }>("select value from public.app_config where key='runner_token'");
      const decision = await database.query<{ id: string }>(`
        select public.runner_record_curation_decision($1,$2::uuid,$3,$4::int,$5,$6,$7,$8::jsonb,$9) id
      `, [
        runner.rows[0]!.value,
        discovery.rows[0]!.id,
        "review",
        61,
        "证据需要人工确认",
        "opendesign-curation-v1.1",
        "fixture-model",
        JSON.stringify(signals),
        "b".repeat(64),
      ]);
      const repository = new DecisionReviewRepository(restrictedClient(database, "opendesign_admin_review_writer_role"));
      const server = createAdminApiServer({
        config: apiConfig,
        passwordVerifier,
        decisionReview: (input, context) => repository.review({
          ...input,
          reviewedBy: context.actor.actorId,
        }, context.signal),
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const port = (server.address() as AddressInfo).port;
        const baseUrl = `http://127.0.0.1:${port}`;
        const login = await fetch(`${baseUrl}/admin-api/v1/login`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: apiConfig.publicOrigin, "sec-fetch-site": "same-origin" },
          body: JSON.stringify({ username: "admin", password: "fixture-password" }),
        });
        expect(login.status).toBe(200);
        const cookie = login.headers.get("set-cookie")!.split(";", 1)[0]!;
        const review = await fetch(`${baseUrl}/admin-api/v1/decisions/review`, {
          method: "POST",
          headers: { cookie, "content-type": "application/json", origin: apiConfig.publicOrigin, "sec-fetch-site": "same-origin" },
          body: JSON.stringify({
            decisionId: decision.rows[0]!.id,
            action: "override",
            recommendation: "approve",
            reason: "人工核对来源与作者证据后批准",
          }),
        });
        expect(review.status).toBe(200);
        expect(await review.json()).toMatchObject({
          decisionId: decision.rows[0]!.id,
          reviewStatus: "overridden",
          recommendation: "approve",
          reviewedBy: "admin",
        });
        const stored = await database.query<{ recommendation: string; final_recommendation: string; review_reason: string }>(`
          select recommendation, final_recommendation, review_reason
          from public.curation_decisions where id=$1
        `, [decision.rows[0]!.id]);
        expect(stored.rows[0]).toEqual({
          recommendation: "review",
          final_recommendation: "approve",
          review_reason: "人工核对来源与作者证据后批准",
        });
        const repeated = await fetch(`${baseUrl}/admin-api/v1/decisions/review`, {
          method: "POST",
          headers: { cookie, "content-type": "application/json", origin: apiConfig.publicOrigin, "sec-fetch-site": "same-origin" },
          body: JSON.stringify({ decisionId: decision.rows[0]!.id, action: "confirm", reason: "不允许重复复核" }),
        });
        expect(repeated.status).toBe(409);
      } finally {
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      }
    } finally {
      await database.close();
    }
  });

  it("rolls back service capabilities while preserving the decision journal", async () => {
    const database = await PGlite.create({ dataDir: "memory://", extensions: { pgcrypto } });
    try {
      await applyAll(database);
      await database.exec(`
        create role opendesign_admin_api_read_login login;
        create role opendesign_admin_api_audit_login login;
        create role opendesign_admin_api_review_login login;
        grant opendesign_admin_read_role to opendesign_admin_api_read_login;
        grant opendesign_admin_audit_writer_role to opendesign_admin_api_audit_login;
        grant opendesign_admin_review_writer_role to opendesign_admin_api_review_login;
      `);
      await database.exec(await readFile(rollbackScript, "utf8"));
      const state = await database.query<{
        schema_exists: boolean;
        group_roles: number;
        login_roles: number;
        journal_exists: boolean;
        runner_exists: boolean;
        lingering_memberships: number;
      }>(`
        select
          to_regnamespace('opendesign_admin_read') is not null schema_exists,
          (select count(*)::int from pg_roles where rolname in (
            'opendesign_admin_read_role','opendesign_admin_audit_writer_role','opendesign_admin_review_writer_role'
          )) group_roles,
          (select count(*)::int from pg_roles where rolname like 'opendesign_admin_api_%_login') login_roles,
          to_regclass('public.curation_decisions') is not null journal_exists,
          to_regprocedure('public.runner_record_curation_decision(text,uuid,text,integer,text,text,text,jsonb,text)') is not null runner_exists,
          (select count(*)::int from pg_auth_members m
            join pg_roles member on member.oid=m.member
            where member.rolname like 'opendesign_admin_api_%_login') lingering_memberships
      `);
      expect(state.rows[0]).toEqual({
        schema_exists: false,
        group_roles: 0,
        login_roles: 3,
        journal_exists: true,
        runner_exists: true,
        lingering_memberships: 0,
      });
    } finally {
      await database.close();
    }
  });
});
