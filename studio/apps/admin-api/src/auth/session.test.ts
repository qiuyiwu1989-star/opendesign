import assert from "node:assert/strict";
import test from "node:test";
import { createSessionManager, expiredSessionCookie, readSessionCookie, sessionCookie } from "./session.js";
import { createSignedTokenCodec } from "./signed-token.js";

const secret = "test-signing-secret-that-is-at-least-32-bytes";

test("signed tokens reject tampering and purpose confusion", () => {
  const session = createSignedTokenCodec(secret, "admin-session");
  const state = createSignedTokenCodec(secret, "another-purpose");
  const token = session.sign("opaque-id");
  assert.equal(session.verify(token), "opaque-id");
  assert.equal(session.verify(`${token.slice(0, -1)}x`), undefined);
  assert.equal(state.verify(token), undefined);
});

test("opaque sessions expire and can be invalidated", () => {
  let timestamp = 1_000;
  let nonce = 0;
  const manager = createSessionManager({ secret, ttlSeconds: 60, now: () => timestamp, randomBytes: () => Buffer.alloc(32, ++nonce) });
  const first = manager.create({ actorId: "admin", login: "admin" });
  assert.equal(manager.verify(first.token)?.actorId, "admin");
  manager.invalidate(first.token);
  assert.equal(manager.verify(first.token), undefined);
  const second = manager.create({ actorId: "admin", login: "admin" });
  timestamp += 60_001;
  assert.equal(manager.verify(second.token), undefined);
});

test("session cookie is host-only, secure and unavailable to scripts", () => {
  const value = sessionCookie("token", 900);
  assert.match(value, /^__Host-opendesign_admin=token; Path=\/;/);
  assert.match(value, /HttpOnly/);
  assert.match(value, /Secure/);
  assert.match(value, /SameSite=Strict/);
  assert.equal(readSessionCookie(`other=x; ${value}`), "token");
  assert.match(expiredSessionCookie(), /Max-Age=0/);
});
