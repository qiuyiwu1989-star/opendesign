#!/usr/bin/env bash
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || { echo "run as root" >&2; exit 1; }

rollback_pointer() {
  local previous="$1" current="$2"
  if [[ ! -L "${previous}" ]]; then
    [[ -L "${current}" ]] && unlink "${current}"
    return
  fi
  local target
  target="$(readlink -f "${previous}")"
  [[ -n "${target}" && -e "${target}" ]] || { echo "previous release pointer is broken" >&2; exit 1; }
  ln -sfn "${target}" "${current}.next"
  mv -Tf "${current}.next" "${current}"
}

rollback_pointer /opt/opendesign/studio-previous /opt/opendesign/studio-current
rollback_pointer /var/www/opendesign.cc/studio.previous /var/www/opendesign.cc/studio
echo "restored previous Studio file pointers"
