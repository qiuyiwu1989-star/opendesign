#!/usr/bin/env bash
set -euo pipefail

release_id="${1:?release id required}"
api_archive="${2:?api archive required}"
web_archive="${3:?web archive required}"
release_root="/opt/opendesign/releases/${release_id}"
api_root="${release_root}/studio/apps/admin-api"
web_stage="/var/www/opendesign.cc/admin.release-${release_id}"

if [[ ! "${release_id}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] || [[ "${release_id}" == "." || "${release_id}" == ".." ]]; then
  echo "invalid release id" >&2
  exit 1
fi

verify_archive() {
  local archive="$1"
  local expected_file="${archive}.sha256"
  [[ -f "${archive}" && -f "${expected_file}" ]] || {
    echo "archive or checksum sidecar missing" >&2
    exit 1
  }
  local expected actual
  expected="$(tr -d '[:space:]' < "${expected_file}")"
  actual="$(sha256sum "${archive}" | awk '{print $1}')"
  [[ "${expected}" =~ ^[0-9a-f]{64}$ && "${actual}" == "${expected}" ]] || {
    echo "archive checksum mismatch" >&2
    exit 1
  }
  python3 - "${archive}" <<'PY'
import pathlib
import posixpath
import sys
import tarfile

with tarfile.open(sys.argv[1], "r:gz") as archive:
    for member in archive.getmembers():
        path = pathlib.PurePosixPath(member.name)
        if path.is_absolute() or ".." in path.parts or member.isdev():
            raise SystemExit("unsafe archive member")
        if member.issym() or member.islnk():
            target = pathlib.PurePosixPath(member.linkname)
            resolved = posixpath.normpath(str(path.parent.joinpath(target)))
            if target.is_absolute() or resolved == ".." or resolved.startswith("../"):
                raise SystemExit("unsafe archive link")
PY
}

verify_archive "${api_archive}"
verify_archive "${web_archive}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "run as root" >&2
  exit 1
fi

if ! getent group opendesign-admin >/dev/null; then
  groupadd --system opendesign-admin
fi
if ! id opendesign-admin >/dev/null 2>&1; then
  useradd --system --gid opendesign-admin --home-dir /nonexistent \
    --shell /usr/sbin/nologin opendesign-admin
fi

if [[ -e "${release_root}" || -e "${web_stage}" ]]; then
  echo "release target already exists" >&2
  exit 1
fi
install -d -o root -g root -m 0755 "${release_root}"
tar -xzf "${api_archive}" -C "${release_root}"
[[ -f "${api_root}/dist/index.js" && -f "${api_root}/package.json" && -d "${api_root}/node_modules/pg" ]] || {
  echo "API archive is incomplete" >&2
  exit 1
}
chown -R root:root "${release_root}"
find "${release_root}" -type d -exec chmod 0755 {} +
find "${release_root}" -type f -exec chmod 0644 {} +

install -d -o root -g root -m 0755 "${web_stage}"
tar -xzf "${web_archive}" -C "${web_stage}"
[[ -f "${web_stage}/index.html" ]] || {
  echo "web archive is incomplete" >&2
  exit 1
}
chown -R root:root "${web_stage}"
find "${web_stage}" -type d -exec chmod 0755 {} +
find "${web_stage}" -type f -exec chmod 0644 {} +

read_password="$(openssl rand -hex 32)"
audit_password="$(openssl rand -hex 32)"
review_password="$(openssl rand -hex 32)"
signing_secret="$(openssl rand -hex 48)"
audit_hash_key="$(openssl rand -hex 48)"

sudo -u postgres psql --dbname opendesign --set ON_ERROR_STOP=1 \
  --set read_password="${read_password}" --set audit_password="${audit_password}" \
  --set review_password="${review_password}" <<'SQL'
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN (
    'opendesign_admin_api_read_login',
    'opendesign_admin_api_audit_login',
    'opendesign_admin_api_review_login'
  )) THEN
    RAISE EXCEPTION 'deployment login already exists; use the reviewed upgrade path';
  END IF;
END $$;
SELECT format('CREATE ROLE opendesign_admin_api_read_login LOGIN PASSWORD %L', :'read_password') \gexec
SELECT format('CREATE ROLE opendesign_admin_api_audit_login LOGIN PASSWORD %L', :'audit_password') \gexec
SELECT format('CREATE ROLE opendesign_admin_api_review_login LOGIN PASSWORD %L', :'review_password') \gexec
ALTER ROLE opendesign_admin_api_read_login NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT;
ALTER ROLE opendesign_admin_api_audit_login NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT;
ALTER ROLE opendesign_admin_api_review_login NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT;
REVOKE opendesign_admin_audit_writer_role, opendesign_admin_review_writer_role FROM opendesign_admin_api_read_login;
REVOKE opendesign_admin_read_role, opendesign_admin_review_writer_role FROM opendesign_admin_api_audit_login;
REVOKE opendesign_admin_read_role, opendesign_admin_audit_writer_role FROM opendesign_admin_api_review_login;
GRANT opendesign_admin_read_role TO opendesign_admin_api_read_login;
GRANT opendesign_admin_audit_writer_role TO opendesign_admin_api_audit_login;
GRANT opendesign_admin_review_writer_role TO opendesign_admin_api_review_login;
ALTER ROLE opendesign_admin_api_read_login SET statement_timeout = '10s';
ALTER ROLE opendesign_admin_api_read_login SET lock_timeout = '1s';
ALTER ROLE opendesign_admin_api_read_login SET idle_in_transaction_session_timeout = '5s';
ALTER ROLE opendesign_admin_api_audit_login SET statement_timeout = '5s';
ALTER ROLE opendesign_admin_api_audit_login SET lock_timeout = '1s';
ALTER ROLE opendesign_admin_api_audit_login SET idle_in_transaction_session_timeout = '5s';
ALTER ROLE opendesign_admin_api_review_login SET statement_timeout = '5s';
ALTER ROLE opendesign_admin_api_review_login SET lock_timeout = '1s';
ALTER ROLE opendesign_admin_api_review_login SET idle_in_transaction_session_timeout = '5s';
SQL

install -d -o root -g root -m 0700 /etc/opendesign
umask 077
pending_env="/etc/opendesign/admin-api.env.pending"
{
  printf '%s\n' 'ADMIN_API_PUBLIC_ORIGIN=https://opendesign.cc'
  printf '%s\n' 'ADMIN_API_HOST=127.0.0.1'
  printf '%s\n' 'ADMIN_API_PORT=18790'
  printf '%s\n' 'ADMIN_API_ADMIN_USERNAME=admin'
  printf '%s\n' 'ADMIN_API_SESSION_TTL_SECONDS=900'
  printf 'ADMIN_API_SIGNING_SECRET=%s\n' "${signing_secret}"
  printf 'ADMIN_API_AUDIT_HASH_KEY=%s\n' "${audit_hash_key}"
  printf 'ADMIN_DATABASE_URL=postgresql://opendesign_admin_api_read_login:%s@127.0.0.1:5432/opendesign\n' "${read_password}"
  printf 'ADMIN_AUDIT_DATABASE_URL=postgresql://opendesign_admin_api_audit_login:%s@127.0.0.1:5432/opendesign\n' "${audit_password}"
  printf 'ADMIN_REVIEW_DATABASE_URL=postgresql://opendesign_admin_api_review_login:%s@127.0.0.1:5432/opendesign\n' "${review_password}"
} > "${pending_env}"
chmod 0600 "${pending_env}"

PGPASSWORD="${read_password}" psql --host 127.0.0.1 --username opendesign_admin_api_read_login \
  --dbname opendesign --set ON_ERROR_STOP=1 --tuples-only --no-align \
  --command 'select count(*) >= 0 from opendesign_admin_read.submissions' >/dev/null
if PGPASSWORD="${read_password}" psql --host 127.0.0.1 --username opendesign_admin_api_read_login \
  --dbname opendesign --command 'select 1 from public.submissions limit 1' >/dev/null 2>&1; then
  echo "read login unexpectedly reached a base table" >&2
  exit 1
fi
PGPASSWORD="${audit_password}" psql --host 127.0.0.1 --username opendesign_admin_api_audit_login \
  --dbname opendesign --set ON_ERROR_STOP=1 >/dev/null <<'SQL'
BEGIN;
SELECT * FROM opendesign_admin_read.write_audit_event(
  'deploy-smoke', clock_timestamp(), '267523620', 'deployment.smoke', 'success',
  '/admin-api/v1/health/ready', 1, null, '{}'::jsonb
);
ROLLBACK;
SQL
if PGPASSWORD="${audit_password}" psql --host 127.0.0.1 --username opendesign_admin_api_audit_login \
  --dbname opendesign --command 'select 1 from opendesign_admin_read.audit_events limit 1' >/dev/null 2>&1; then
  echo "audit login unexpectedly read audit rows" >&2
  exit 1
fi
PGPASSWORD="${review_password}" psql --host 127.0.0.1 --username opendesign_admin_api_review_login \
  --dbname opendesign --set ON_ERROR_STOP=1 --tuples-only --no-align \
  --command "select outcome from opendesign_admin_read.review_curation_decision('00000000-0000-0000-0000-000000000000','deploy-smoke','confirm',null,'权限边界演练')" \
  | grep -qx 'not_found'
if PGPASSWORD="${review_password}" psql --host 127.0.0.1 --username opendesign_admin_api_review_login \
  --dbname opendesign --command 'select 1 from public.curation_decisions limit 1' >/dev/null 2>&1; then
  echo "review login unexpectedly read decision rows" >&2
  exit 1
fi
if PGPASSWORD="${review_password}" psql --host 127.0.0.1 --username opendesign_admin_api_review_login \
  --dbname opendesign --command "select * from opendesign_admin_read.write_audit_event('deploy-smoke',clock_timestamp(),null,'deployment.smoke','success','/admin-api/v1/health/ready',1,null,'{}'::jsonb)" >/dev/null 2>&1; then
  echo "review login unexpectedly executed the audit writer" >&2
  exit 1
fi

echo "prepared release ${release_id}; no public pointer was changed"
echo "an interactive password hash and separately approved activation are still required"
