#!/usr/bin/env bash
set -u -o pipefail

# READ-ONLY SERVER PREFLIGHT. This script does not install, migrate, reload,
# restart, activate, rotate, write configuration, or print environment values.
database_name="${ADMIN_PREFLIGHT_DATABASE_NAME:-opendesign}"
service_name="${ADMIN_PREFLIGHT_SERVICE_NAME:-opendesign-admin-api.service}"
environment_file="${ADMIN_PREFLIGHT_ENV_FILE:-/etc/opendesign/admin-api.env}"
api_port="${ADMIN_PREFLIGHT_API_PORT:-18790}"
failures=0

pass() {
  printf '[PASS] %s\n' "$1"
}

fail() {
  printf '[FAIL] %s\n' "$1" >&2
  failures=$((failures + 1))
}

check_command() {
  command -v "$1" >/dev/null 2>&1 || {
    fail "required command missing: $1"
    return 1
  }
}

check_service() {
  local unit="$1"
  if systemctl is-active --quiet "${unit}"; then
    pass "service active: ${unit}"
  else
    fail "service inactive: ${unit}"
  fi
}

check_env_key() {
  local key="$1"
  if grep -q "^${key}=" "${environment_file}"; then
    pass "environment key present: ${key}"
  else
    fail "environment key missing: ${key}"
  fi
}

psql_scalar() {
  sudo -u postgres psql --dbname "${database_name}" --no-psqlrc \
    --tuples-only --no-align --set ON_ERROR_STOP=1 --command "$1"
}

check_sql_true() {
  local label="$1"
  local query="$2"
  local result
  if result="$(psql_scalar "${query}" 2>/dev/null)" && [[ "${result}" == "t" ]]; then
    pass "${label}"
  else
    fail "${label}"
  fi
}

if [[ "$(id -u)" -ne 0 ]]; then
  echo "read-only production preflight must run as root" >&2
  exit 2
fi

for command in systemctl nginx ss curl sudo psql grep stat readlink; do
  check_command "${command}" || true
done
if (( failures > 0 )); then
  echo "preflight cannot continue without required commands" >&2
  exit 2
fi

check_service nginx.service
check_service postgresql.service
check_service "${service_name}"

if nginx -t -q >/dev/null 2>&1; then
  pass "nginx configuration validates"
else
  fail "nginx configuration validation failed"
fi

if ss -H -ltn "sport = :${api_port}" | grep -qE "^[^ ]+[[:space:]]+[^ ]+[[:space:]]+[^ ]+[[:space:]]+127\.0\.0\.1:${api_port}[[:space:]]"; then
  pass "Admin API listens on loopback:${api_port}"
else
  fail "Admin API loopback listener missing on port ${api_port}"
fi
if ss -H -ltn "sport = :${api_port}" | grep -qE "[[:space:]](0\.0\.0\.0|\[::\]|\*):${api_port}[[:space:]]"; then
  fail "Admin API port is exposed beyond loopback"
else
  pass "Admin API port is not publicly bound"
fi

live_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  --max-time 5 "http://127.0.0.1:${api_port}/admin-api/v1/health/live" || true)"
if [[ "${live_status}" == "200" ]]; then
  pass "loopback live endpoint"
else
  fail "loopback live endpoint returned ${live_status:-000}"
fi

if [[ -f "${environment_file}" ]]; then
  if [[ "$(stat -c %a "${environment_file}")" == "600" ]]; then
    pass "environment file mode is 0600"
  else
    fail "environment file mode is not 0600"
  fi
  for key in \
    ADMIN_API_HOST \
    ADMIN_API_PORT \
    ADMIN_API_PUBLIC_ORIGIN \
    ADMIN_API_SIGNING_SECRET \
    ADMIN_API_AUDIT_HASH_KEY \
    ADMIN_API_ADMIN_USERNAME \
    ADMIN_API_PASSWORD_HASH \
    ADMIN_DATABASE_URL \
    ADMIN_AUDIT_DATABASE_URL \
    ADMIN_REVIEW_DATABASE_URL; do
    check_env_key "${key}"
  done
else
  fail "environment file missing"
fi

server_version="$(psql_scalar "show server_version" 2>/dev/null || true)"
if [[ "${server_version}" == 18.4* ]]; then
  pass "PostgreSQL server version ${server_version}"
else
  fail "PostgreSQL server version is ${server_version:-unavailable}, expected 18.4.x"
fi

check_sql_true "curation decision journal exists" \
  "select to_regclass('public.curation_decisions') is not null"
check_sql_true "review function exists" \
  "select to_regprocedure('opendesign_admin_read.review_curation_decision(uuid,text,text,text,text)') is not null"
check_sql_true "read, audit and review NOLOGIN roles exist" \
  "select count(*) = 3 from pg_roles where rolname in ('opendesign_admin_read_role','opendesign_admin_audit_writer_role','opendesign_admin_review_writer_role') and not rolcanlogin"
check_sql_true "three isolated deployment LOGINs exist" \
  "select count(*) = 3 from pg_roles where rolname in ('opendesign_admin_api_read_login','opendesign_admin_api_audit_login','opendesign_admin_api_review_login') and rolcanlogin and not rolsuper and not rolcreatedb and not rolcreaterole"
check_sql_true "review LOGIN has only review membership" \
  "select coalesce(array_agg(r.rolname order by r.rolname), '{}'::name[]) = array['opendesign_admin_review_writer_role']::name[] from pg_auth_members m join pg_roles u on u.oid=m.member join pg_roles r on r.oid=m.roleid where u.rolname='opendesign_admin_api_review_login'"
check_sql_true "review role cannot read the decision journal" \
  "select not has_table_privilege('opendesign_admin_review_writer_role','public.curation_decisions','select') and not has_table_privilege('opendesign_admin_review_writer_role','public.curation_decisions','update')"

for pointer in /opt/opendesign/current /var/www/opendesign.cc/admin; do
  if [[ -L "${pointer}" ]] && readlink -e "${pointer}" >/dev/null; then
    pass "release pointer resolves: ${pointer}"
  else
    fail "release pointer missing or not atomic symlink: ${pointer}"
  fi
done

if systemctl is-enabled --quiet certbot.timer && systemctl is-active --quiet certbot.timer; then
  pass "certbot renewal timer enabled and active"
elif systemctl is-enabled --quiet snap.certbot.renew.timer && systemctl is-active --quiet snap.certbot.renew.timer; then
  pass "snap certbot renewal timer enabled and active"
else
  fail "no enabled and active certbot renewal timer found"
fi

if (( failures > 0 )); then
  printf 'summary: NO-GO (%d failed checks)\n' "${failures}" >&2
  exit 1
fi
echo "summary: GO (read-only evidence complete)"
