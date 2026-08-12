import type {
  LibraryAsset,
  PipelineRun,
  ReviewCase,
  ReviewPriority,
  SignalState,
  SyncNode,
  SyncSnapshot,
  TodayAction,
  TodaySnapshot,
} from "../domain";
import type { GitReadOnlySnapshot } from "./types";

const priorityRank: Record<ReviewPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function aggregateReviews(
  assets: readonly LibraryAsset[],
  supplied: readonly ReviewCase[] = [],
): ReviewCase[] {
  const generated = assets.flatMap<ReviewCase>((asset) => {
    if (asset.quality.origin === "unavailable") {
      return [{
        id: `origin:${asset.id}`,
        source: "origin",
        status: "pending",
        priority: "critical",
        title: `${asset.title} 的来源不可用`,
        summary: "静态快照记录了不可用来源，需要人工核对原站与公开页。",
        assetId: asset.id,
        url: asset.url,
        quality: asset.quality,
        evidence: ["origin_status=unavailable"],
        previewOnly: true,
      } as ReviewCase];
    }
    if (asset.quality.origin === "degraded") {
      return [{
        id: `quality:${asset.id}:preview`,
        source: "quality",
        status: "pending",
        priority: "high",
        title: `${asset.title} 缺少可用预览`,
        summary: "索引中的预览图为空，建议重新采集或确认 no-preview 策略。",
        assetId: asset.id,
        url: asset.url,
        quality: asset.quality,
        evidence: ["image is empty"],
        previewOnly: true,
      }];
    }
    if (!asset.hasSpec) {
      return [{
        id: `quality:${asset.id}:spec`,
        source: "quality",
        status: "pending",
        priority: "medium",
        title: `${asset.title} 缺少设计规范`,
        summary: "资源存在，但静态索引没有可用的设计规范。",
        assetId: asset.id,
        url: asset.url,
        quality: asset.quality,
        evidence: ["has_spec=false"],
        previewOnly: true,
      }];
    }
    return [];
  });

  const byId = new Map<string, ReviewCase>();
  for (const review of [...generated, ...supplied]) byId.set(review.id, review);
  return [...byId.values()].sort((a, b) =>
    priorityRank[a.priority] - priorityRank[b.priority]
    || (b.createdAt ?? "").localeCompare(a.createdAt ?? "")
    || a.id.localeCompare(b.id),
  );
}

export function aggregatePipelines(runs: readonly PipelineRun[] = []): PipelineRun[] {
  return runs
    .map((run) => ({
      ...run,
      previewOnly: true as const,
      checkpoints: run.checkpoints.map((checkpoint) => ({ ...checkpoint })),
    }))
    .sort((a, b) => (b.createdAt ?? b.startedAt ?? "").localeCompare(a.createdAt ?? a.startedAt ?? ""));
}

function node(
  location: SyncNode["location"],
  label: string,
  revision: string | undefined,
  observedAt: string | undefined,
  drift: SyncNode["drift"],
  detail?: string,
): SyncNode {
  return {
    location,
    label,
    ...(revision ? { revision } : {}),
    ...(observedAt ? { observedAt } : {}),
    drift,
    state: drift === "in-sync" ? "healthy" : drift === "unknown" ? "unknown" : "attention",
    ...(detail ? { detail } : {}),
  };
}

export function aggregateSync(git?: GitReadOnlySnapshot): SyncSnapshot {
  if (!git) {
    return {
      state: "unknown",
      summary: "未注入只读 Git/GitHub/Public 快照，无法判断漂移。",
      nodes: [
        node("database", "Database", undefined, undefined, "unknown", "Phase 1 未连接生产数据库"),
        node("local", "Local", undefined, undefined, "unknown"),
        node("git", "Git", undefined, undefined, "unknown"),
        node("github", "GitHub", undefined, undefined, "unknown"),
        node("public", "Public", undefined, undefined, "unknown"),
      ],
      readOnly: true,
    };
  }

  const baseline = git.gitRevision ?? git.localRevision;
  const driftFor = (revision?: string): SyncNode["drift"] => {
    if (!revision || !baseline) return "unknown";
    return revision === baseline ? "in-sync" : "diverged";
  };
  const nodes: SyncNode[] = [
    node("database", "Database", undefined, undefined, "unknown", "Phase 1 未连接生产数据库"),
    node(
      "local",
      "Local",
      git.localRevision,
      git.localObservedAt,
      git.dirty ? "ahead" : driftFor(git.localRevision),
      git.dirty ? "工作区存在未提交变更" : undefined,
    ),
    node("git", "Git", git.gitRevision, git.gitObservedAt, driftFor(git.gitRevision)),
    node("github", "GitHub", git.githubRevision, git.githubObservedAt, driftFor(git.githubRevision)),
    node("public", "Public", git.publicRevision, git.publicObservedAt, driftFor(git.publicRevision)),
  ];
  const known = nodes.filter((item) => item.drift !== "unknown");
  const drifted = known.filter((item) => item.drift !== "in-sync");
  const state: SignalState = drifted.length ? "attention" : known.length >= 2 ? "healthy" : "unknown";
  return {
    state,
    summary: drifted.length
      ? `${drifted.length} 个位置与本地 Git 基线不一致。`
      : known.length >= 2
        ? "已注入的位置与本地 Git 基线一致。"
        : "可比较的只读修订信息不足。",
    ...(git.branch ? { branch: git.branch } : {}),
    ...(git.localRevision ? { localRevision: git.localRevision } : {}),
    nodes,
    readOnly: true,
  };
}

function pipelineSignal(runs: readonly PipelineRun[]): SignalState {
  if (!runs.length) return "unknown";
  if (runs.some((run) => run.status === "failed")) return "blocked";
  if (runs.some((run) => run.status === "queued" || run.status === "running")) return "attention";
  if (runs.some((run) => run.status === "unknown")) return "unknown";
  return "healthy";
}

export function aggregateToday(
  assets: readonly LibraryAsset[],
  reviews: readonly ReviewCase[],
  pipelines: readonly PipelineRun[],
  sync: SyncSnapshot,
): TodaySnapshot {
  const pendingReviews = reviews.filter((review) => review.status === "pending");
  const criticalReviews = pendingReviews.filter((review) => review.priority === "critical");
  const failedRuns = pipelines.filter((run) => run.status === "failed");
  const actions: TodayAction[] = [];

  if (criticalReviews.length) actions.push({
    id: "today:critical-reviews",
    kind: "review",
    priority: "critical",
    title: "处理关键审阅",
    summary: `${criticalReviews.length} 条来源或内容问题需要优先判断。`,
    target: "review",
    ...(criticalReviews[0] ? { targetId: criticalReviews[0].id } : {}),
    count: criticalReviews.length,
    previewOnly: true,
  });
  if (failedRuns.length) actions.push({
    id: "today:failed-pipelines",
    kind: "pipeline",
    priority: "high",
    title: "检查失败管线",
    summary: `${failedRuns.length} 次运行失败；Phase 1 仅提供定位与重试预览。`,
    target: "pipelines",
    ...(failedRuns[0] ? { targetId: failedRuns[0].id } : {}),
    count: failedRuns.length,
    previewOnly: true,
  });
  if (sync.state === "attention" || sync.state === "blocked") actions.push({
    id: "today:sync-drift",
    kind: "sync",
    priority: sync.state === "blocked" ? "critical" : "high",
    title: "检查同步漂移",
    summary: sync.summary,
    target: "sync",
    previewOnly: true,
  });
  const regularReviews = pendingReviews.filter((review) => review.priority !== "critical");
  if (regularReviews.length) actions.push({
    id: "today:review-inbox",
    kind: "review",
    priority: "medium",
    title: "清理统一审阅箱",
    summary: `${regularReviews.length} 条质量、发现或投稿事项等待判断。`,
    target: "review",
    ...(regularReviews[0] ? { targetId: regularReviews[0].id } : {}),
    count: regularReviews.length,
    previewOnly: true,
  });
  const withoutPack = assets.filter((asset) => !asset.hasPack).length;
  if (withoutPack) actions.push({
    id: "today:pack-coverage",
    kind: "quality",
    priority: "low",
    title: "提升完整包覆盖率",
    summary: `${withoutPack} 条资源目前只有规范或基础资料。`,
    target: "assets",
    count: withoutPack,
    previewOnly: true,
  });

  actions.sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority] || a.id.localeCompare(b.id));
  const pSignal = pipelineSignal(pipelines);
  const state: SignalState = actions.some((action) => action.priority === "critical")
    ? "blocked"
    : actions.length ? "attention" : "healthy";
  return {
    state,
    topActions: actions.slice(0, 3),
    funnel: {
      totalAssets: assets.length,
      withSpec: assets.filter((asset) => asset.hasSpec).length,
      withPack: assets.filter((asset) => asset.hasPack).length,
      accepted: assets.filter((asset) => asset.quality.curation === "accepted").length,
      recommended: assets.filter((asset) => asset.quality.curation === "recommended").length,
      pendingReviews: pendingReviews.length,
    },
    pipelineSignal: pSignal,
    syncSignal: sync.state,
  };
}
