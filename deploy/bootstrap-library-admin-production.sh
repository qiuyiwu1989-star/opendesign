#!/usr/bin/env bash
set -euo pipefail

release_id="${1:?release id required}"
api_archive="${2:?api archive required}"
web_archive="${3:?web archive required}"
release_root="/opt/opendesign/releases/${release_id}"
api_root="${release_root}/studio/apps/admin-api"
web_stage="/var/www/opendesign.cc/admin.release-${release_id}"

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

install -d -o root -g root -m 0755 "${release_root}"
tar -xzf "${api_archive}" -C "${release_root}"
npm install --omit=dev --ignore-scripts --no-audit --no-fund --prefix "${api_root}"
chown -R root:root "${release_root}"
find "${release_root}" -type d -exec chmod 0755 {} +
find "${release_root}" -type f -exec chmod 0644 {} +

install -d -o root -g root -m 0755 "${web_stage}"
tar -xzf "${web_archive}" -C "${web_stage}"
chown -R root:root "${web_stage}"
find "${web_stage}" -type d -exec chmod 0755 {} +
find "${web_stage}" -type f -exec chmod 0644 {} +

read_password="$(openssl rand -hex 32)"
audit_password="$(openssl rand -hex 32)"
signing_secret="$(openssl rand -hex 48)"
audit_hash_key="$(openssl rand -hex 48)"

sudo -u postgres psql --dbname opendesign --set ON_ERROR_STOP=1 \
  --set read_password="${read_password}" --set audit_password="${audit_password}" <<'SQL'
SELECT format('CREATE ROLE opendesign_admin_api_read_login LOGIN PASSWORD %L', :'read_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'opendesign_admin_api_read_login') \gexec
SELECT format('ALTER ROLE opendesign_admin_api_read_login PASSWORD %L', :'read_password') \gexec
SELECT format('CREATE ROLE opendesign_admin_api_audit_login LOGIN PASSWORD %L', :'audit_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'opendesign_admin_api_audit_login') \gexec
SELECT format('ALTER ROLE opendesign_admin_api_audit_login PASSWORD %L', :'audit_password') \gexec
ALTER ROLE opendesign_admin_api_read_login NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT;
ALTER ROLE opendesign_admin_api_audit_login NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT;
GRANT opendesign_admin_read_role TO opendesign_admin_api_read_login;
GRANT opendesign_admin_audit_writer_role TO opendesign_admin_api_audit_login;
ALTER ROLE opendesign_admin_api_read_login SET statement_timeout = '10s';
ALTER ROLE opendesign_admin_api_read_login SET lock_timeout = '1s';
ALTER ROLE opendesign_admin_api_read_login SET idle_in_transaction_session_timeout = '5s';
ALTER ROLE opendesign_admin_api_audit_login SET statement_timeout = '5s';
ALTER ROLE opendesign_admin_api_audit_login SET lock_timeout = '1s';
ALTER ROLE opendesign_admin_api_audit_login SET idle_in_transaction_session_timeout = '5s';
SQL

install -d -o root -g root -m 0700 /etc/opendesign
umask 077
pending_env="/etc/opendesign/admin-api.env.pending"
{
  printf '%s\n' 'ADMIN_API_PUBLIC_ORIGIN=https://opendesign.cc'
  printf '%s\n' 'ADMIN_API_HOST=127.0.0.1'
  printf '%s\n' 'ADMIN_API_PORT=18790'
  printf '%s\n' 'ADMIN_API_GITHUB_ALLOWED_USER_IDS=267523620'
  printf '%s\n' 'ADMIN_API_SESSION_TTL_SECONDS=900'
  printf '%s\n' 'ADMIN_API_STATE_TTL_SECONDS=300'
  printf 'ADMIN_API_SIGNING_SECRET=%s\n' "${signing_secret}"
  printf 'ADMIN_API_AUDIT_HASH_KEY=%s\n' "${audit_hash_key}"
  printf 'ADMIN_DATABASE_URL=postgresql://opendesign_admin_api_read_login:%s@127.0.0.1:5432/opendesign\n' "${read_password}"
  printf 'ADMIN_AUDIT_DATABASE_URL=postgresql://opendesign_admin_api_audit_login:%s@127.0.0.1:5432/opendesign\n' "${audit_password}"
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

ln -sfn "${release_root}" /opt/opendesign/current
echo "prepared release ${release_id}; OAuth values are still required before service start"
