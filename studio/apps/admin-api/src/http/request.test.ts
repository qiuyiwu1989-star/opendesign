import assert from "node:assert/strict";
import test from "node:test";
import { safeReturnPath } from "./request.js";

test("return paths remain same-origin and inside admin", () => {
  assert.equal(safeReturnPath(null), "/admin/");
  assert.equal(safeReturnPath("/admin/reviews?queue=quality"), "/admin/reviews?queue=quality");
  assert.equal(safeReturnPath("https://evil.example/admin"), undefined);
  assert.equal(safeReturnPath("//evil.example/admin"), undefined);
  assert.equal(safeReturnPath("/other"), undefined);
  assert.equal(safeReturnPath("/admin\\evil"), undefined);
});
