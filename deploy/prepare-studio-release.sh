#!/usr/bin/env bash
set -euo pipefail

release_id="${1:?release id required}"
web_archive="${2:?web archive required}"
runtime_archive="${3:?runtime archive required}"
release_root="/opt/opendesign/studio-releases/${release_id}"
web_target="/var/www/opendesign.cc/studio.release-${release_id}"

[[ "$(id -u)" -eq 0 ]] || { echo "run as root" >&2; exit 1; }
[[ "${release_id}" =~ ^[a-f0-9]{12}$ ]] || { echo "invalid release id" >&2; exit 1; }
[[ -f "${web_archive}" && -f "${runtime_archive}" ]] || { echo "release archive missing" >&2; exit 1; }
[[ ! -e "${release_root}" && ! -e "${web_target}" ]] || { echo "release target already exists" >&2; exit 1; }

install -d -o root -g root -m 0755 "${release_root}" "${web_target}"
tar -xzf "${runtime_archive}" -C "${release_root}"
tar -xzf "${web_archive}" -C "${web_target}"
chown -R root:root "${release_root}" "${web_target}"
find "${release_root}" "${web_target}" -type d -exec chmod 0755 {} +
find "${release_root}" "${web_target}" -type f -exec chmod 0644 {} +

# Install after normalizing archive permissions so npm-created native binaries
# retain their executable bits. Scripts are never run during installation.
cd "${release_root}/studio"
npm ci --ignore-scripts
test -x node_modules/@esbuild/linux-x64/bin/esbuild
test -f apps/local-api/dist/main.js
test -f "${web_target}/index.html"

echo "prepared Studio release ${release_id}; no public pointer changed"
