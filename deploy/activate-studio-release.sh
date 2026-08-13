#!/usr/bin/env bash
set -euo pipefail

release_id="${1:?release id required}"
release_root="/opt/opendesign/studio-releases/${release_id}"
web_target="/var/www/opendesign.cc/studio.release-${release_id}"
runtime_current="/opt/opendesign/studio-current"
runtime_previous="/opt/opendesign/studio-previous"
web_current="/var/www/opendesign.cc/studio"
web_previous="/var/www/opendesign.cc/studio.previous"

[[ "$(id -u)" -eq 0 ]] || { echo "run as root" >&2; exit 1; }
[[ "${release_id}" =~ ^[a-f0-9]{12}$ ]] || { echo "invalid release id" >&2; exit 1; }
[[ -f "${release_root}/studio/apps/local-api/dist/main.js" && -f "${web_target}/index.html" ]] || {
  echo "prepared Studio release is incomplete" >&2
  exit 1
}

capture_previous() {
  local current="$1" previous="$2"
  if [[ -L "${current}" ]]; then
    local target
    target="$(readlink -f "${current}")"
    [[ -n "${target}" && -e "${target}" ]] || { echo "current release pointer is broken" >&2; exit 1; }
    ln -sfn "${target}" "${previous}.next"
    mv -Tf "${previous}.next" "${previous}"
  elif [[ -e "${current}" ]]; then
    echo "current release path must be a symlink: ${current}" >&2
    exit 1
  fi
}

activate_pointer() {
  local target="$1" current="$2"
  ln -sfn "${target}" "${current}.next"
  mv -Tf "${current}.next" "${current}"
}

capture_previous "${runtime_current}" "${runtime_previous}"
capture_previous "${web_current}" "${web_previous}"
activate_pointer "${release_root}" "${runtime_current}"
activate_pointer "${web_target}" "${web_current}"

echo "activated Studio file pointers for ${release_id}"
echo "service restart and nginx reload remain separate actions"
