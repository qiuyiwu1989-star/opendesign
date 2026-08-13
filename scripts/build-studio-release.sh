#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
commit="$(git -C "${repo_root}" rev-parse HEAD)"
release_id="${commit:0:12}"
output_root="${1:-${repo_root}/.release/studio-${release_id}}"
stage="$(mktemp -d)"
trap 'rm -rf "${stage}"' EXIT

[[ -z "$(git -C "${repo_root}" status --porcelain)" ]] || {
  echo "studio release builds require a clean worktree" >&2
  exit 1
}

cd "${repo_root}/studio"
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build

mkdir -p "${output_root}" "${stage}/runtime/studio/apps/local-api"
cp -R "${repo_root}/studio/apps/web/dist" "${stage}/web"
# Build runtime only from tracked files. This prevents ignored local projects,
# uploaded assets, caches, environment files, or node_modules from entering a
# release archive. The compiled API is the only generated directory added.
git -C "${repo_root}" archive HEAD:studio | tar -x -C "${stage}/runtime/studio"
cp -R "${repo_root}/studio/apps/local-api/dist" "${stage}/runtime/studio/apps/local-api/dist"
COPYFILE_DISABLE=1 tar -czf "${output_root}/opendesign-studio-web-${release_id}.tar.gz" -C "${stage}/web" .
COPYFILE_DISABLE=1 tar -czf "${output_root}/opendesign-studio-runtime-${release_id}.tar.gz" -C "${stage}/runtime" studio

web_sha="$(shasum -a 256 "${output_root}/opendesign-studio-web-${release_id}.tar.gz" | awk '{print $1}')"
runtime_sha="$(shasum -a 256 "${output_root}/opendesign-studio-runtime-${release_id}.tar.gz" | awk '{print $1}')"
cat > "${output_root}/release-manifest.json" <<EOF
{
  "schema": "opendesign.studio-release.v1",
  "releaseId": "${release_id}",
  "commit": "${commit}",
  "webSha256": "${web_sha}",
  "runtimeSha256": "${runtime_sha}",
  "publicPath": "/studio/",
  "apiBind": "127.0.0.1:8794"
}
EOF

echo "studio release candidate built: ${output_root}"
