#!/usr/bin/env bash
set -euo pipefail

# PRODUCTION ACTIVATION ARTIFACT ONLY. Running this changes public file pointers
# and requires explicit deployment approval for the named release.
release_id="${1:?release id required}"
release_root="/opt/opendesign/releases/${release_id}"
api_target="${release_root}/studio/apps/admin-api"
web_target="/var/www/opendesign.cc/admin.release-${release_id}"
api_current="/opt/opendesign/current"
api_previous="/opt/opendesign/previous"
web_current="/var/www/opendesign.cc/admin"
web_previous="/var/www/opendesign.cc/admin.previous"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "run as root" >&2
  exit 1
fi
if [[ ! "${release_id}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] || [[ "${release_id}" == "." || "${release_id}" == ".." ]]; then
  echo "invalid release id" >&2
  exit 1
fi
[[ -f "${api_target}/dist/index.js" && -f "${web_target}/index.html" ]] || {
  echo "prepared release is incomplete" >&2
  exit 1
}

capture_previous() {
  local current="$1"
  local previous="$2"
  if [[ -L "${current}" ]]; then
    local target
    target="$(readlink -f "${current}")"
    [[ -n "${target}" && -e "${target}" ]] || {
      echo "current release pointer is broken" >&2
      exit 1
    }
    ln -sfn "${target}" "${previous}.next"
    mv -Tf "${previous}.next" "${previous}"
  elif [[ -e "${current}" ]]; then
    echo "current release path must be a symlink" >&2
    exit 1
  fi
}

activate_pointer() {
  local target="$1"
  local current="$2"
  ln -sfn "${target}" "${current}.next"
  mv -Tf "${current}.next" "${current}"
}

capture_previous "${api_current}" "${api_previous}"
capture_previous "${web_current}" "${web_previous}"
activate_pointer "${release_root}" "${api_current}"
activate_pointer "${web_target}" "${web_current}"

echo "activated file pointers for ${release_id}"
echo "service restart and nginx reload remain separate approved actions"
