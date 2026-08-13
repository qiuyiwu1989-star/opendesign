import type { CurationDecision, PipelineRun, ReviewCase } from "../domain";
import type { GitReadOnlySnapshot, SnapshotAdapterInput } from "./types";

/**
 * Small, visibly synthetic fixture for tests/Storybook-like previews only.
 * Consumers must keep its `source` state as `snapshot` and label it synthetic.
 */
export const syntheticSiteIndexFixture = {
  _meta: {
    version: "fixture-1",
    built_at: "2026-08-12T00:00:00.000Z",
    count: 3,
  },
  sites: [
    {
      id: "fixture-complete",
      title: "Fixture Complete",
      url: "https://example.com/complete",
      image: "https://example.com/complete.png",
      tags: ["Editorial", "Fixture"],
      status: "completed",
      has_spec: true,
      has_pack: true,
    },
    {
      id: "fixture-spec",
      title: "Fixture Spec",
      url: "https://example.com/spec",
      image: "https://example.com/spec.png",
      tags: ["Product", "Fixture"],
      status: "completed",
      has_spec: true,
      has_pack: false,
    },
    {
      id: "fixture-preview-missing",
      title: "Fixture Preview Missing",
      url: "https://example.com/no-preview",
      image: "",
      tags: ["Fixture"],
      status: "completed",
      has_spec: false,
      has_pack: false,
    },
  ],
} as const;

export const syntheticReviewFixture: ReviewCase[] = [{
  id: "submission:fixture-1",
  source: "submission",
  status: "pending",
  priority: "medium",
  title: "Synthetic submission",
  summary: "Fixture only; this is not a production submission.",
  createdAt: "2026-08-12T00:00:00.000Z",
  evidence: ["synthetic fixture"],
  previewOnly: true,
}];

export const syntheticPipelineFixture: PipelineRun[] = [{
  id: "pipeline:fixture-1",
  kind: "collect",
  label: "Synthetic collection run",
  status: "failed",
  createdAt: "2026-08-12T00:00:00.000Z",
  summary: "Fixture only; no production pipeline ran.",
  checkpoints: [
    { id: "discover", label: "Discover", status: "completed" },
    { id: "extract", label: "Extract", status: "failed", detail: "Synthetic failure" },
    { id: "validate", label: "Validate", status: "pending" },
  ],
  retryFromCheckpointId: "extract",
  previewOnly: true,
}];

export const syntheticDecisionFixture: CurationDecision[] = [{
  id: "decision:fixture-ad",
  candidateId: "fixture-ad",
  candidateTitle: "Synthetic affiliate gallery",
  candidateUrl: "https://example.com/affiliate",
  recommendation: "reject",
  confidence: 96,
  reason: "页面以联盟跳转和付费推广为主，缺少可复用的原创设计证据。",
  policyVersion: "opendesign-curation-v1.0",
  model: "mimo-v2.5",
  decidedAt: "2026-08-12T00:15:00.000Z",
  reviewStatus: "pending",
  aiJudgment: {
    id: "decision:fixture-ad",
    holderType: "agent",
    holderId: "mimo-v2.5",
    subjectId: "fixture-ad",
    statement: "reject",
    asOf: "2026-08-12T00:15:00.000Z",
    reason: "页面以联盟跳转和付费推广为主，缺少可复用的原创设计证据。",
    provenance: {
      source: "daily-ai-curator",
      aiDecisionId: "decision:fixture-ad",
      policyVersion: "opendesign-curation-v1.0",
      model: "mimo-v2.5",
    },
  },
  signals: [
    { id: "design-value", label: "设计价值", state: "warn", score: 42, evidence: ["视觉证据不足"] },
    { id: "originality", label: "原创性", state: "fail", score: 18, evidence: ["聚合内容重复"] },
    { id: "utility", label: "可复用性", state: "fail", score: 20, evidence: ["无可迁移组件或 token"] },
    { id: "evidence", label: "证据完整度", state: "warn", score: 36, evidence: ["仅有 meta 信息"] },
    { id: "spam-risk", label: "垃圾风险", state: "fail", score: 91, evidence: ["关键词堆叠", "重复落地页"] },
    { id: "ad-risk", label: "广告风险", state: "fail", score: 96, evidence: ["联盟跳转"] },
    { id: "safety", label: "安全", state: "pass", score: 92, evidence: ["未发现恶意下载"] },
  ],
  source: { kind: "snapshot", label: "synthetic AI decision fixture", generatedAt: "2026-08-12T00:15:00.000Z" },
  previewOnly: true,
}];

export const syntheticGitFixture: GitReadOnlySnapshot = {
  branch: "fixture/read-only",
  localRevision: "fixture-local",
  gitRevision: "fixture-local",
  githubRevision: "fixture-remote",
  publicRevision: "fixture-public",
  dirty: false,
};

export const syntheticSnapshotFixture: SnapshotAdapterInput = {
  siteIndex: syntheticSiteIndexFixture,
  packIndex: { "fixture-complete": { fixture: true } },
  reviews: syntheticReviewFixture,
  decisions: syntheticDecisionFixture,
  reviewSource: { kind: "snapshot", label: "synthetic review fixture" },
  pipelines: syntheticPipelineFixture,
  pipelineSource: { kind: "snapshot", label: "synthetic pipeline fixture" },
  syncSource: { kind: "snapshot", label: "synthetic sync fixture" },
  git: syntheticGitFixture,
  now: "2026-08-12T00:00:00.000Z",
};
