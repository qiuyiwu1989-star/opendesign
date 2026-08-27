#!/usr/bin/env bash
set -euo pipefail

# PRODUCTION ROLLBACK ARTIFACT ONLY. Running this changes public file pointers
# and requires explicit rollback approval.
api_current="/opt/opendesign/current"
api_previous="/opt/opendesign/previous"
web_current="/var/www/opendesign.cc/admin"
web_previous="/var/www/opendesign.cc/admin.previous"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "run as root" >&2
  exit 1
fi

rollback_pointer() {
  local previous="$1"
  local current="$2"
  if [[ ! -L "${previous}" ]]; then
    [[ -L "${current}" ]] || {
      echo "previous release pointer missing and current path is not a symlink" >&2
      exit 1
    }
    unlink "${current}"
    return
  fi
  local target
  target="$(readlink -f "${previous}")"
  [[ -n "${target}" && -e "${target}" ]] || {
    echo "previous release pointer is broken" >&2
    exit 1
  }
  ln -sfn "${target}" "${current}.next"
  mv -Tf "${current}.next" "${current}"
}

rollback_pointer "${api_previous}" "${api_current}"
rollback_pointer "${web_previous}" "${web_current}"

echo "restored previous Admin API and Admin Web file pointers"
echo "a missing previous pointer means the first-release symlink was removed"
echo "service restart remains a separate approved action"
