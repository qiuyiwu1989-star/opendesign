import type {
  AssetCoverage,
  CurationDecision,
  DecisionRecommendation,
  DecisionSignal,
  LibraryAsset,
  SignalState,
} from "../domain";

export const CURATION_POLICY_VERSION = "opendesign-curation-v1.0";

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

export function assetCoverage(input: {
  imageUrl?: string;
  hasSpec: boolean;
  hasPack: boolean;
  publicPath: string;
  packPath?: string;
  observedAt?: string;
}): AssetCoverage {
  const previewReady = Boolean(input.imageUrl);
  const states = [previewReady, input.hasSpec, input.hasPack, input.hasPack];
  const issues = [
    ...(!previewReady ? ["缺少可用预览图"] : []),
    ...(!input.hasSpec ? ["缺少结构化设计规范"] : []),
    ...(!input.hasPack ? ["缺少可复制的设计包"] : []),
    ...(!input.hasPack ? ["设计资产清单尚未建立"] : []),
  ];
  const observed = input.observedAt ? { observedAt: input.observedAt } : {};
  return {
    preview: { status: previewReady ? "ready" : "missing", ...(input.imageUrl ? { path: input.imageUrl } : {}), ...observed },
    spec: { status: input.hasSpec ? "ready" : "missing", path: input.publicPath, ...observed },
    pack: { status: input.hasPack ? "ready" : "missing", ...(input.packPath ? { path: input.packPath } : {}), ...observed },
    assets: { status: input.hasPack ? "ready" : "missing", ...(input.packPath ? { path: input.packPath } : {}), ...observed },
    completeness: Math.round(states.filter(Boolean).length / states.length * 100),
    issues,
  };
}

export function decisionRecommendation(signals: readonly DecisionSignal[]): DecisionRecommendation {
  const hardReject = signals.some((signal) => ["spam-risk", "ad-risk", "safety"].includes(signal.id) && signal.state === "fail");
  if (hardReject) return "reject";
  if (signals.some((signal) => signal.state === "fail" || signal.state === "warn")) return "review";
  return "approve";
}

export function decisionSignal(decisions: readonly CurationDecision[]): SignalState {
  if (!decisions.length) return "unknown";
  if (decisions.some((decision) => decision.reviewStatus === "pending" && decision.recommendation === "reject")) return "blocked";
  if (decisions.some((decision) => decision.reviewStatus === "pending")) return "attention";
  return "healthy";
}

export function qualitySummary(assets: readonly LibraryAsset[], decisions: readonly CurationDecision[]) {
  const reviewed = decisions.filter((decision) => decision.reviewStatus !== "pending").length;
  return {
    readyAssets: assets.filter((asset) => asset.artifacts.completeness === 100).length,
    missingPreviews: assets.filter((asset) => asset.artifacts.preview.status !== "ready").length,
    missingPacks: assets.filter((asset) => asset.artifacts.pack.status !== "ready").length,
    pendingDecisions: decisions.length - reviewed,
    rejectedByAi: decisions.filter((decision) => decision.recommendation === "reject").length,
    reviewRate: decisions.length ? clamp(reviewed / decisions.length * 100) : 0,
  };
}
