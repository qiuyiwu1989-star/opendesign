import { describe, expect, it } from "vitest";
import fixture from "@opendesign/studio-contracts/fixtures/proposal-v0";
import { parseWorkOrderQaPayload, parseWorkOrderScenePayload } from "./api";

describe("011 progressive Artifact payload gates", () => {
  it("accepts the canonical logical Scene IR canvas and rejects look-alike units", () => {
    expect(parseWorkOrderScenePayload(fixture).documentId).toBe(fixture.documentId);
    expect(() => parseWorkOrderScenePayload({ ...fixture, canvas: { ...fixture.canvas, unit: "px" } })).toThrow(/Scene IR 阶段产物格式无效/u);
  });

  it("requires native non-negative QA counts whose sum is exact", () => {
    const valid = { documentId: fixture.documentId, summary: { blocker: 0, error: 0, warning: 1, note: 0, total: 1 }, issues: [] };
    expect(parseWorkOrderQaPayload(valid).summary.total).toBe(1);
    expect(() => parseWorkOrderQaPayload({ ...valid, summary: { ...valid.summary, error: "0" } })).toThrow(/QA 阶段产物格式无效/u);
    expect(() => parseWorkOrderQaPayload({ ...valid, summary: { ...valid.summary, total: 2 } })).toThrow(/QA 阶段产物格式无效/u);
  });
});
