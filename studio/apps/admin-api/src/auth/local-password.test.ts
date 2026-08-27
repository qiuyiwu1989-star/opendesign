import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import test from "node:test";
import { createLocalPasswordVerifier, parsePasswordHash } from "./local-password.js";

function encoded(password: string): string {
  const salt = Buffer.alloc(16, 7);
  const digest = scryptSync(password, salt, 32, { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$32768$8$1$${salt.toString("base64url")}$${digest.toString("base64url")}`;
}

test("verifies the reviewed scrypt format without retaining a plaintext password", async () => {
  const verifier = createLocalPasswordVerifier(encoded("a-strong-local-password"));
  assert.equal(await verifier.verify("a-strong-local-password"), true);
  assert.equal(await verifier.verify("wrong-password"), false);
});

test("rejects weaker, oversized, or malformed hash parameters", async () => {
  assert.throws(() => parsePasswordHash("scrypt$1024$8$1$c2FsdA$ZGlnZXN0"), /reviewed scrypt format/u);
  assert.throws(() => parsePasswordHash("not-a-password-hash"), /reviewed scrypt format/u);
  const verifier = createLocalPasswordVerifier(encoded("a-strong-local-password"));
  assert.equal(await verifier.verify("x".repeat(1025)), false);
});
