#!/usr/bin/env bash
set -euo pipefail

# EXISTING-INSTALLATION UPGRADE ARTIFACT ONLY. Running this creates one
# review-only database LOGIN and a pending environment file. It requires
# explicit database/configuration approval. It never rotates read/audit logins.
current_env="/etc/opendesign/admin-api.env"
pending_env="/etc/opendesign/admin-api.env.pending"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "run as root" >&2
  exit 1
fi
[[ -f "${current_env}" ]] || {
  echo "current Admin API environment file missing" >&2
  exit 1
}
[[ "$(stat -c %a "${current_env}")" == "600" ]] || {
  echo "current Admin API environment file must be mode 0600" >&2
  exit 1
}
grep -q '^ADMIN_DATABASE_URL=' "${current_env}" || {
  echo "current read database URL missing" >&2
  exit 1
}
grep -q '^ADMIN_AUDIT_DATABASE_URL=' "${current_env}" || {
  echo "current audit database URL missing" >&2
  exit 1
}

if grep -q '^ADMIN_REVIEW_DATABASE_URL=' "${current_env}"; then
  install -o root -g root -m 0600 "${current_env}" "${pending_env}"
  echo "review database URL already configured; prepared an unchanged pending environment"
  exit 0
fi

if sudo -u postgres psql --dbname opendesign --tuples-only --no-align \
  --command "select 1 from pg_roles where rolname='opendesign_admin_api_review_login'" | grep -qx 1; then
  echo "review login exists without a matching environment value; refusing password rotation" >&2
  exit 1
fi

review_password="$(openssl rand -hex 32)"
env_stage="$(mktemp /etc/opendesign/admin-api.env.pending.XXXXXX)"
trap 'rm -f "${env_stage}"' EXIT
install -o root -g root -m 0600 "${current_env}" "${env_stage}"
printf 'ADMIN_REVIEW_DATABASE_URL=postgresql://opendesign_admin_api_review_login:%s@127.0.0.1:5432/opendesign\n' \
  "${review_password}" >> "${env_stage}"

sudo -u postgres psql --dbname opendesign --set ON_ERROR_STOP=1 \
  --set review_password="${review_password}" <<'SQL'
SELECT format('CREATE ROLE opendesign_admin_api_review_login LOGIN PASSWORD %L', :'review_password') \gexec
ALTER ROLE opendesign_admin_api_review_login NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT;
REVOKE opendesign_admin_read_role, opendesign_admin_audit_writer_role FROM opendesign_admin_api_review_login;
GRANT opendesign_admin_review_writer_role TO opendesign_admin_api_review_login;
ALTER ROLE opendesign_admin_api_review_login SET statement_timeout = '5s';
ALTER ROLE opendesign_admin_api_review_login SET lock_timeout = '1s';
ALTER ROLE opendesign_admin_api_review_login SET idle_in_transaction_session_timeout = '5s';
SQL

PGPASSWORD="${review_password}" psql --host 127.0.0.1 --username opendesign_admin_api_review_login \
  --dbname opendesign --set ON_ERROR_STOP=1 --tuples-only --no-align \
  --command "select outcome from opendesign_admin_read.review_curation_decision('00000000-0000-0000-0000-000000000000','deploy-smoke','confirm',null,'权限边界演练')" \
  | grep -qx 'not_found'
if PGPASSWORD="${review_password}" psql --host 127.0.0.1 --username opendesign_admin_api_review_login \
  --dbname opendesign --command 'select 1 from public.curation_decisions limit 1' >/dev/null 2>&1; then
  echo "review login unexpectedly read decision rows" >&2
  exit 1
fi

mv -f "${env_stage}" "${pending_env}"
trap - EXIT
echo "prepared review-only capability without changing current read/audit credentials"
