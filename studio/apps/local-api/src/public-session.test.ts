import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPublicSessionQuota,
  createPublicSessionCodec,
  DEFAULT_PUBLIC_SESSION_QUOTA,
  hashPublicSessionScope,
  isPublicSessionExpired,
  parseSessionScope,
  PublicSessionQuotaError,
  sessionRecordFromIdentity,
} from "./public-session.js";

const DAY_MS = 24 * 60 * 60 * 1_000;
const secret = "a-test-only-public-session-secret-with-more-than-32-bytes";

function fixtureCodec(now: { value: number }, fill = 7) {
  return createPublicSessionCodec({
    secret,
    clock: { now: () => new Date(now.value) },
    random: { bytes: (size) => new Uint8Array(size).fill(fill) },
  });
}

test("public session codec issues a high-entropy signed HttpOnly cookie and opaque scope", () => {
  const now = { value: Date.parse("2026-08-14T00:00:00.000Z") };
  const issued = fixtureCodec(now).issue();
  const encodedPayload = issued.token.split(".")[1]!;
  const opaqueSessionId = (JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as { id: string }).id;
  assert.match(opaqueSessionId, /^[A-Za-z0-9_-]{43}$/);
  assert.match(issued.identity.scope, /^scope_[a-f0-9]{64}$/);
  assert.equal(issued.identity.scope.includes(opaqueSessionId), false);
  assert.equal("sessionId" in issued.identity, false);
  assert.match(issued.setCookie, /^opendesign_studio_session=v1\./);
  assert.match(issued.setCookie, /; Path=\/; Max-Age=604800; HttpOnly; Secure; SameSite=Lax$/);
  assert.equal(fixtureCodec(now).verify(issued.token)?.scope, issued.identity.scope);
});

test("cookie header resolution reuses, renews, and replaces invalid sessions without exposing raw tokens", () => {
  const now = { value: Date.parse("2026-08-14T00:00:00.000Z") };
  const codec = fixtureCodec(now);
  const issued = codec.issue();

  const reused = codec.resolveCookieHeader(`unrelated=x; opendesign_studio_session=${issued.token}`);
  assert.equal(reused.identity.scope, issued.identity.scope);
  assert.equal(reused.setCookie, undefined);

  now.value += 6.5 * DAY_MS;
  const renewed = codec.resolveCookieHeader(`opendesign_studio_session=${issued.token}`);
  assert.equal(renewed.identity.scope, issued.identity.scope);
  assert.ok(renewed.setCookie);
  assert.equal(renewed.identity.maximumExpiresAt, issued.identity.maximumExpiresAt);

  const tampered = codec.resolveCookieHeader(`opendesign_studio_session=${issued.token.slice(0, -1)}x`);
  assert.notEqual(tampered.identity.scope, "");
  assert.ok(tampered.setCookie);
});

test("sessions expire after idle TTL and renewal never extends past 30 days", () => {
  const now = { value: Date.parse("2026-08-14T00:00:00.000Z") };
  const codec = fixtureCodec(now);
  let issued = codec.issue();
  const maximum = issued.identity.maximumExpiresAt;

  for (let index = 0; index < 4; index += 1) {
    now.value += 6.5 * DAY_MS;
    const renewed = codec.resolveCookieHeader(`opendesign_studio_session=${issued.token}`);
    assert.ok(renewed.setCookie);
    const token = renewed.setCookie!.match(/^[^=]+=([^;]+)/)?.[1];
    assert.ok(token);
    issued = { identity: renewed.identity, token: token!, setCookie: renewed.setCookie! };
  }
  assert.equal(issued.identity.maximumExpiresAt, maximum);
  assert.ok(Date.parse(issued.identity.expiresAt) <= Date.parse(maximum));

  now.value = Date.parse(maximum);
  assert.equal(codec.verify(issued.token), null);
  assert.equal(isPublicSessionExpired(sessionRecordFromIdentity(issued.identity), new Date(now.value)), true);
});

test("scope derivation is keyed, validated, and rejects path-like values", () => {
  const id = new Uint8Array(32).fill(3);
  const sessionId = Buffer.from(id).toString("base64url");
  const first = hashPublicSessionScope(sessionId, secret);
  const second = hashPublicSessionScope(sessionId, `${secret}-different`);
  assert.notEqual(first, second);
  assert.equal(parseSessionScope(first), first);
  assert.throws(() => parseSessionScope("../scope_deadbeef"), /Invalid session scope/);
  assert.throws(() => hashPublicSessionScope("short", secret), /Invalid anonymous session identifier/);
  assert.throws(() => createPublicSessionCodec({ secret: "too short" }), /at least 32 bytes/);
});

test("shared quota model reports the exact exceeded resource", () => {
  const usage = { projects: 20, revisions: 99, assetBytes: 0, exports: 0, runningJobs: 0 };
  assert.throws(
    () => assertPublicSessionQuota(usage, { projects: 1 }, DEFAULT_PUBLIC_SESSION_QUOTA),
    (error) => error instanceof PublicSessionQuotaError && error.resource === "projects" && error.limit === 20,
  );
  assert.doesNotThrow(() => assertPublicSessionQuota(usage, { revisions: 1 }, DEFAULT_PUBLIC_SESSION_QUOTA));
  assert.throws(() => assertPublicSessionQuota(usage, { runningJobs: -1 }), /Invalid quota delta/);
});
