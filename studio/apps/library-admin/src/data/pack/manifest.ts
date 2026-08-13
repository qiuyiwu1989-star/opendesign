/**
 * Browser-safe Pack availability index.
 *
 * The public `packs-index.json` includes every file in every Design Pack and is
 * several megabytes large. Control Room only needs membership plus enough
 * provenance to explain where that answer came from.
 */
export const COMPACT_PACK_MANIFEST_SCHEMA = "opendesign.pack-manifest.v1" as const;

export interface CompactPackManifestProvenance {
  source: "packs-index.json";
  generatedAt: string;
  sourceCount: number;
  sourceBytes?: number;
  sourceRevision?: string;
}

export interface CompactPackManifest {
  schema: typeof COMPACT_PACK_MANIFEST_SCHEMA;
  packIds: string[];
  provenance: CompactPackManifestProvenance;
}

export interface PackManifestDiagnostic {
  code:
    | "pack-manifest-invalid-root"
    | "pack-manifest-invalid-schema"
    | "pack-manifest-invalid-provenance"
    | "pack-manifest-invalid-id"
    | "pack-manifest-count-mismatch"
    | "pack-manifest-request-failed";
  level: "warning" | "error";
  message: string;
}

export interface ParsedCompactPackManifest {
  manifest?: CompactPackManifest;
  ids?: ReadonlySet<string>;
  diagnostics: PackManifestDiagnostic[];
  state: "available" | "degraded" | "unavailable";
}

export interface CompactPackManifestBuildInput {
  generatedAt: string;
  sourceBytes?: number;
  sourceRevision?: string;
}

export interface LoadCompactPackManifestInput {
  url?: string;
  fetcher?: typeof fetch;
}

const DEFAULT_URL = "/admin/pack-manifest.json";
const PACK_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidPackId(value: unknown): value is string {
  return isNonEmptyString(value) && PACK_ID_PATTERN.test(value);
}

/** Build-time transform. It deliberately reads keys only, never Pack values. */
export function createCompactPackManifest(
  packIndex: unknown,
  provenance: CompactPackManifestBuildInput,
): CompactPackManifest {
  if (!isRecord(packIndex)) throw new TypeError("packs-index.json must be an object");
  if (!isNonEmptyString(provenance.generatedAt)) throw new TypeError("generatedAt must be a non-empty string");

  const invalidIds = Object.keys(packIndex).filter((id) => !isValidPackId(id));
  if (invalidIds.length) {
    throw new TypeError(`packs-index.json contains invalid pack ids: ${invalidIds.slice(0, 5).join(", ")}`);
  }

  const packIds = [...new Set(Object.keys(packIndex))].sort();
  return {
    schema: COMPACT_PACK_MANIFEST_SCHEMA,
    packIds,
    provenance: {
      source: "packs-index.json",
      generatedAt: provenance.generatedAt,
      sourceCount: packIds.length,
      ...(provenance.sourceBytes === undefined ? {} : { sourceBytes: provenance.sourceBytes }),
      ...(provenance.sourceRevision ? { sourceRevision: provenance.sourceRevision } : {}),
    },
  };
}

/**
 * Runtime parser with record-level degradation. One malformed id cannot hide
 * hundreds of valid Packs; structural/provenance failures make the provider
 * unavailable because their evidence cannot be trusted.
 */
export function parseCompactPackManifest(input: unknown): ParsedCompactPackManifest {
  const diagnostics: PackManifestDiagnostic[] = [];
  if (!isRecord(input)) {
    return {
      state: "unavailable",
      diagnostics: [{
        code: "pack-manifest-invalid-root",
        level: "error",
        message: "Compact Pack manifest root must be an object.",
      }],
    };
  }
  if (input.schema !== COMPACT_PACK_MANIFEST_SCHEMA || !Array.isArray(input.packIds)) {
    return {
      state: "unavailable",
      diagnostics: [{
        code: "pack-manifest-invalid-schema",
        level: "error",
        message: "Compact Pack manifest schema or packIds is invalid.",
      }],
    };
  }
  const rawProvenance = input.provenance;
  if (
    !isRecord(rawProvenance)
    || rawProvenance.source !== "packs-index.json"
    || !isNonEmptyString(rawProvenance.generatedAt)
    || typeof rawProvenance.sourceCount !== "number"
    || !Number.isInteger(rawProvenance.sourceCount)
    || rawProvenance.sourceCount < 0
  ) {
    return {
      state: "unavailable",
      diagnostics: [{
        code: "pack-manifest-invalid-provenance",
        level: "error",
        message: "Compact Pack manifest provenance is missing or invalid.",
      }],
    };
  }

  const validIds: string[] = [];
  input.packIds.forEach((value, index) => {
    if (!isValidPackId(value)) {
      diagnostics.push({
        code: "pack-manifest-invalid-id",
        level: "warning",
        message: `packIds[${index}] is invalid and was ignored.`,
      });
      return;
    }
    validIds.push(value);
  });
  const packIds = [...new Set(validIds)].sort();
  if (rawProvenance.sourceCount !== packIds.length) {
    diagnostics.push({
      code: "pack-manifest-count-mismatch",
      level: "warning",
      message: `Manifest declares ${rawProvenance.sourceCount} Packs but ${packIds.length} valid unique ids were parsed.`,
    });
  }

  const manifest: CompactPackManifest = {
    schema: COMPACT_PACK_MANIFEST_SCHEMA,
    packIds,
    provenance: {
      source: "packs-index.json",
      generatedAt: rawProvenance.generatedAt,
      sourceCount: rawProvenance.sourceCount,
      ...(typeof rawProvenance.sourceBytes === "number" && rawProvenance.sourceBytes >= 0
        ? { sourceBytes: rawProvenance.sourceBytes }
        : {}),
      ...(isNonEmptyString(rawProvenance.sourceRevision)
        ? { sourceRevision: rawProvenance.sourceRevision }
        : {}),
    },
  };
  return {
    manifest,
    ids: new Set(packIds),
    diagnostics,
    state: diagnostics.length ? "degraded" : "available",
  };
}

/** Independent loader: Pack evidence failure is data, not an app exception. */
export async function loadCompactPackManifest(
  input: LoadCompactPackManifestInput = {},
): Promise<ParsedCompactPackManifest> {
  const url = input.url ?? DEFAULT_URL;
  try {
    const fetcher = input.fetcher ?? globalThis.fetch;
    if (!fetcher) throw new Error("fetch is unavailable");
    const response = await fetcher(url, {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return parseCompactPackManifest(await response.json());
  } catch (error) {
    return {
      state: "unavailable",
      diagnostics: [{
        code: "pack-manifest-request-failed",
        level: "warning",
        message: `Compact Pack manifest is unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
      }],
    };
  }
}
