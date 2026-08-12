import type {
  AdminSnapshot,
  CurationStatus,
  DataSourceDescriptor,
  EvidenceTier,
  LibraryAsset,
  OriginStatus,
  SnapshotDiagnostic,
} from "../domain";
import { aggregatePipelines, aggregateReviews, aggregateSync, aggregateToday } from "./aggregate";
import {
  SnapshotValidationError,
  type SnapshotAdapterInput,
  type StaticSiteIndex,
  type StaticSiteIndexEntry,
} from "./types";

const DEFAULT_NOW = "1970-01-01T00:00:00.000Z";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function parseStaticSiteIndex(input: unknown): StaticSiteIndex {
  const issues: string[] = [];
  if (!isRecord(input)) throw new SnapshotValidationError(["root must be an object"]);
  if (!Array.isArray(input.sites)) throw new SnapshotValidationError(["sites must be an array"]);

  const sites: StaticSiteIndexEntry[] = [];
  input.sites.forEach((item, index) => {
    if (!isRecord(item)) {
      issues.push(`sites[${index}] must be an object`);
      return;
    }
    const id = optionalString(item.id);
    const title = optionalString(item.title);
    const url = optionalString(item.url);
    if (!id || !title || !url) {
      issues.push(`sites[${index}] requires non-empty id, title and url`);
      return;
    }
    const tags = Array.isArray(item.tags)
      ? item.tags.filter((tag): tag is string => typeof tag === "string")
      : undefined;
    const image = optionalString(item.image);
    const status = optionalString(item.status);
    sites.push({
      id,
      title,
      url,
      ...(image ? { image } : {}),
      ...(tags ? { tags } : {}),
      ...(status ? { status } : {}),
      ...(typeof item.has_spec === "boolean" ? { has_spec: item.has_spec } : {}),
      ...(typeof item.has_pack === "boolean" ? { has_pack: item.has_pack } : {}),
    });
  });
  if (issues.length) throw new SnapshotValidationError(issues.slice(0, 20));

  const meta = isRecord(input._meta) ? input._meta : undefined;
  const version = meta ? optionalString(meta.version) : undefined;
  const builtAt = meta ? optionalString(meta.built_at) : undefined;
  return {
    sites,
    ...(meta ? {
      _meta: {
        ...(version ? { version } : {}),
        ...(builtAt ? { built_at: builtAt } : {}),
        ...(typeof meta.count === "number" ? { count: meta.count } : {}),
      },
    } : {}),
  };
}

function evidenceTier(site: StaticSiteIndexEntry): EvidenceTier {
  if (site.has_pack) return "E3";
  if (site.has_spec) return "E2";
  if (site.image) return "E1";
  return "E0";
}

function curationStatus(site: StaticSiteIndexEntry): CurationStatus {
  // The existing index has no explicit editorial recommendation field.  A
  // completed record is accepted into the library, not implicitly recommended.
  return site.status === "completed" ? "accepted" : "unreviewed";
}

function originStatus(site: StaticSiteIndexEntry): OriginStatus {
  // A static snapshot cannot prove current liveness. `changed` means the origin
  // needs a fresh check; concrete broken/missing-preview evidence remains more
  // specific and must not be softened.
  if (site.status === "broken" || !site.url) return "unavailable";
  if (!site.image) return "degraded";
  return "changed";
}

export function parseStaticPackIds(input: unknown): ReadonlySet<string> {
  if (!isRecord(input)) throw new SnapshotValidationError(["pack index must be an object"]);
  return new Set(Object.keys(input));
}

export function mapStaticAssets(
  index: StaticSiteIndex,
  packIds?: ReadonlySet<string>,
): LibraryAsset[] {
  return index.sites.map((site) => ({
    id: site.id,
    title: site.title,
    url: site.url,
    ...(site.image ? { imageUrl: site.image } : {}),
    tags: [...(site.tags ?? [])],
    status: site.status ?? "unknown",
    quality: {
      evidence: packIds?.has(site.id) ? "E3" : evidenceTier(site),
      curation: curationStatus(site),
      origin: originStatus(site),
    },
    hasSpec: site.has_spec === true,
    hasPack: packIds?.has(site.id) ?? site.has_pack === true,
    publicPath: `/en/sites/${encodeURIComponent(site.id)}`,
    ...(packIds?.has(site.id) || site.has_pack ? { packPath: `/packs/${encodeURIComponent(site.id)}/` } : {}),
    ...(index._meta?.built_at ? { updatedAt: index._meta.built_at } : {}),
  }));
}

function unavailable(label: string, detail: string): DataSourceDescriptor {
  return { kind: "unavailable", label, detail };
}

export function createSnapshotAdapter(input: SnapshotAdapterInput) {
  return {
    id: "static-library-snapshot",
    async load(): Promise<AdminSnapshot> {
      const index = parseStaticSiteIndex(input.siteIndex);
      const packIds = input.packIndex ? parseStaticPackIds(input.packIndex) : undefined;
      const assets = mapStaticAssets(index, packIds);
      const generatedAt = index._meta?.built_at ?? input.now ?? DEFAULT_NOW;
      const diagnostics: SnapshotDiagnostic[] = [];
      if (index._meta?.count !== undefined && index._meta.count !== assets.length) {
        diagnostics.push({
          code: "snapshot-count-mismatch",
          level: "warning",
          message: `索引声明 ${index._meta.count} 条，但实际解析 ${assets.length} 条。`,
        });
      }
      if (!input.reviews) diagnostics.push({
        code: "reviews-live-unavailable",
        level: "info",
        message: "发现与投稿 RPC 未连接；审阅箱仅包含从静态资产推导的质量事项。",
      });
      if (!packIds) diagnostics.push({
        code: "pack-index-unavailable",
        level: input.packIndexUnavailable ? "warning" : "info",
        message: "packs-index.json 未加载；完整包状态退回 sites-index.json 的嵌入标记。",
      });
      if (!input.pipelines) diagnostics.push({
        code: "pipelines-live-unavailable",
        level: "info",
        message: "任务与日志 RPC 未连接；没有把示例管线表示为真实运行。",
      });
      if (!input.sync && !input.git) diagnostics.push({
        code: "sync-snapshot-unavailable",
        level: "info",
        message: "未注入 GitHub/Public 只读快照，漂移状态未知。",
      });

      const reviews = aggregateReviews(assets, input.reviews);
      const pipelines = aggregatePipelines(input.pipelines);
      const sync = input.sync ?? aggregateSync(input.git);
      const today = aggregateToday(assets, reviews, pipelines, sync);
      const librarySource: DataSourceDescriptor = {
        kind: "snapshot",
        label: packIds ? "sites-index.json + packs-index.json" : "sites-index.json",
        generatedAt,
        detail: index._meta?.version ? `schema ${index._meta.version}` : "checked-in static snapshot",
      };
      const reviewSource = input.reviewSource ?? (
        input.reviews
          ? { kind: "snapshot", label: "injected review snapshot", generatedAt }
          : unavailable("production review queues", "Discovery/submission RPCs are intentionally disconnected")
      );
      const pipelineSource = input.pipelineSource ?? (
        input.pipelines
          ? { kind: "snapshot", label: "injected pipeline snapshot", generatedAt }
          : unavailable("production pipeline runs", "Job/log RPCs are intentionally disconnected")
      );
      const syncSource = input.syncSource ?? (
        input.sync || input.git
          ? { kind: "snapshot", label: "injected read-only sync snapshot", generatedAt }
          : unavailable("GitHub/public sync", "No read-only revision snapshot was injected")
      );

      return {
        source: librarySource,
        sources: {
          library: librarySource,
          reviews: reviewSource,
          pipelines: pipelineSource,
          sync: syncSource,
        },
        generatedAt,
        assets,
        reviews,
        pipelines,
        sync,
        today,
        diagnostics,
      };
    },
  };
}
