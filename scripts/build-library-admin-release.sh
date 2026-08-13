#!/usr/bin/env bash
set -euo pipefail

output_dir="${1:?output directory required}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "${output_dir}" != /* ]]; then
  echo "output directory must be absolute" >&2
  exit 1
fi
if [[ -n "$(git -C "${repo_root}" status --porcelain)" ]]; then
  echo "release builds require a clean worktree" >&2
  exit 1
fi
if [[ -e "${output_dir}" ]]; then
  echo "output directory already exists" >&2
  exit 1
fi

commit="$(git -C "${repo_root}" rev-parse HEAD)"
branch="$(git -C "${repo_root}" branch --show-current)"
release_id="${commit:0:12}"
stage="$(mktemp -d)"
trap 'rm -rf "${stage}"' EXIT

cd "${repo_root}/studio"
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
npm run test:release --workspace @opendesign/library-admin-api

api_stage="${stage}/api/studio/apps/admin-api"
web_stage="${stage}/web"
install -d "${api_stage}" "${web_stage}" "${output_dir}"
cp -R "${repo_root}/studio/apps/admin-api/dist" "${api_stage}/dist"
cp "${repo_root}/studio/apps/admin-api/package.json" "${api_stage}/package.json"

# Resolve and freeze runtime dependencies in the artifact. Production does not
# run npm or contact the registry; it only verifies and extracts this archive.
npm install --omit=dev --ignore-scripts --no-audit --no-fund --package-lock=true --prefix "${api_stage}"
rm -rf "${api_stage}/node_modules/.bin"
cp -R "${repo_root}/studio/apps/library-admin/dist/." "${web_stage}/"

api_archive="${output_dir}/opendesign-admin-api-${release_id}.tar.gz"
web_archive="${output_dir}/opendesign-library-admin-${release_id}.tar.gz"
COPYFILE_DISABLE=1 tar -czf "${api_archive}" -C "${stage}/api" studio
COPYFILE_DISABLE=1 tar -czf "${web_archive}" -C "${web_stage}" .

sha256_value() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

api_sha="$(sha256_value "${api_archive}")"
web_sha="$(sha256_value "${web_archive}")"
printf '%s\n' "${api_sha}" > "${api_archive}.sha256"
printf '%s\n' "${web_sha}" > "${web_archive}.sha256"

COMMIT="${commit}" BRANCH="${branch}" RELEASE_ID="${release_id}" \
API_NAME="$(basename "${api_archive}")" API_SHA="${api_sha}" API_SIZE="$(stat -f %z "${api_archive}" 2>/dev/null || stat -c %s "${api_archive}")" \
WEB_NAME="$(basename "${web_archive}")" WEB_SHA="${web_sha}" WEB_SIZE="$(stat -f %z "${web_archive}" 2>/dev/null || stat -c %s "${web_archive}")" \
NODE_VERSION="$(node --version)" NPM_VERSION="$(npm --version)" \
python3 - "${output_dir}/release-manifest.json" <<'PY'
import datetime
import json
import os
import sys

manifest = {
    "schema": "opendesign.library-admin-release.v1",
    "releaseId": os.environ["RELEASE_ID"],
    "commit": os.environ["COMMIT"],
    "branch": os.environ["BRANCH"],
    "createdAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "toolchain": {"node": os.environ["NODE_VERSION"], "npm": os.environ["NPM_VERSION"]},
    "artifacts": [
        {"kind": "admin-api", "file": os.environ["API_NAME"], "sha256": os.environ["API_SHA"], "bytes": int(os.environ["API_SIZE"])},
        {"kind": "library-admin", "file": os.environ["WEB_NAME"], "sha256": os.environ["WEB_SHA"], "bytes": int(os.environ["WEB_SIZE"])},
    ],
}
with open(sys.argv[1], "w", encoding="utf-8") as target:
    json.dump(manifest, target, ensure_ascii=False, indent=2)
    target.write("\n")
PY

echo "release candidate built: ${output_dir}"
