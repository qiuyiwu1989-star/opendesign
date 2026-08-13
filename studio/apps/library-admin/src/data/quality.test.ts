import { describe, expect, it } from "vitest";
import type { DecisionSignal } from "../domain";
import { assetCoverage, decisionRecommendation } from "./quality";

describe("content quality policy", () => {
  it("keeps preview, spec, pack and assets independently observable", () => {
    const coverage = assetCoverage({ imageUrl: "/preview.webp", hasSpec: true, hasPack: false, publicPath: "/sites/example" });
    expect(coverage).toMatchObject({
      preview: { status: "ready" }, spec: { status: "ready" },
      pack: { status: "missing" }, assets: { status: "missing" }, completeness: 50,
    });
    expect(coverage.issues).toEqual(["缺少可复制的设计包", "设计资产清单尚未建立"]);
  });

  it("quarantines spam, ads and unsafe candidates instead of averaging them away", () => {
    const signals: DecisionSignal[] = [
      { id: "design-value", label: "设计价值", state: "pass", score: 95, evidence: ["distinctive"] },
      { id: "ad-risk", label: "广告风险", state: "fail", score: 96, evidence: ["affiliate redirects"] },
    ];
    expect(decisionRecommendation(signals)).toBe("reject");
  });
});
