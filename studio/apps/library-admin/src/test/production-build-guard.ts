export const BUILD_BUDGETS = {
  compactPackManifestBytes: 64 * 1024,
  javascriptAssetBytes: 350 * 1024,
  totalDistBytes: 1_250 * 1024,
} as const;

export interface BuildArtifact {
  path: string;
  bytes: number;
}

export interface BuildGuardResult {
  ok: boolean;
  errors: string[];
  compactManifestBytes?: number;
  totalBytes: number;
}

/** Pure build-output gate. CI may feed it a recursive `dist` file listing. */
export function verifyProductionBuild(artifacts: readonly BuildArtifact[]): BuildGuardResult {
  const errors: string[] = [];
  const normalized = artifacts.map((artifact) => ({
    ...artifact,
    path: artifact.path.replaceAll("\\", "/").replace(/^\.\//, ""),
  }));
  const totalBytes = normalized.reduce((total, artifact) => total + artifact.bytes, 0);
  const forbidden = normalized.find((artifact) => artifact.path === "packs-index.json" || artifact.path.endsWith("/packs-index.json"));
  if (forbidden) errors.push("dist must not contain the full packs-index.json");

  const manifests = normalized.filter((artifact) => artifact.path === "pack-manifest.json" || artifact.path.endsWith("/pack-manifest.json"));
  if (manifests.length !== 1) {
    errors.push(`dist must contain exactly one compact pack-manifest.json (found ${manifests.length})`);
  }
  const compactManifestBytes = manifests[0]?.bytes;
  if (compactManifestBytes !== undefined && compactManifestBytes > BUILD_BUDGETS.compactPackManifestBytes) {
    errors.push(`pack-manifest.json exceeds ${BUILD_BUDGETS.compactPackManifestBytes} bytes`);
  }

  for (const artifact of normalized.filter(({ path }) => path.endsWith(".js"))) {
    if (artifact.bytes > BUILD_BUDGETS.javascriptAssetBytes) {
      errors.push(`${artifact.path} exceeds ${BUILD_BUDGETS.javascriptAssetBytes} bytes`);
    }
  }
  if (totalBytes > BUILD_BUDGETS.totalDistBytes) {
    errors.push(`dist total exceeds ${BUILD_BUDGETS.totalDistBytes} bytes`);
  }
  return {
    ok: errors.length === 0,
    errors,
    ...(compactManifestBytes === undefined ? {} : { compactManifestBytes }),
    totalBytes,
  };
}
