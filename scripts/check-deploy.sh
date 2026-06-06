#!/usr/bin/env bash
set -euo pipefail

target="${1:-staging}"

case "$target" in
  staging)
    frontend_url="${FRONTEND_STAGING_URL:-https://jobdone-staging.vercel.app}"
    backend_url="${BACKEND_STAGING_URL:-https://jobdone-backend-staging.vercel.app}"
    ;;
  production|prod)
    frontend_url="${FRONTEND_PRODUCTION_URL:-https://jobdone.continuumkit.org}"
    backend_url="${BACKEND_PRODUCTION_URL:-https://jobdone-backend-production.vercel.app}"
    ;;
  *)
    echo "Usage: $0 staging|production" >&2
    exit 1
    ;;
esac

frontend_build="$(
  curl -fsSL "$frontend_url/" |
    grep -Eo '[a-f0-9]{7}' |
    head -n 1
)"
backend_build="$(
  curl -fsSI "$backend_url/health" |
    tr -d '\r' |
    awk 'tolower($1) == "x-jobdone-build:" { print $2; exit }'
)"

echo "$target frontend: $frontend_url ($frontend_build)"
echo "$target backend:  $backend_url ($backend_build)"

if [[ -z "$frontend_build" || -z "$backend_build" ]]; then
  echo "Could not read frontend/backend build ids." >&2
  exit 1
fi

if [[ "$frontend_build" != "$backend_build" ]]; then
  echo "Build mismatch: frontend=$frontend_build backend=$backend_build" >&2
  exit 1
fi

echo "$target build ids match."

if [[ "$target" == "staging" || "$target" == "production" || "$target" == "prod" ]]; then
  local_replica_health="$(curl -fsSL "$backend_url/api/local-replica/health")"
  node -e '
    const health = JSON.parse(process.argv[1]);
    const target = process.argv[2];
    if (health.configured !== true || health.schema !== "jobdone_next") {
      console.error(`Local Replica not configured for ${target}: ${JSON.stringify(health)}`);
      process.exit(1);
    }
  ' "$local_replica_health" "$target"
  echo "$target local replica configured."
fi

if [[ "$target" == "staging" ]]; then
  legacy_status="$(
    curl -sS -o /dev/null -w '%{http_code}' \
      -X POST "$backend_url/api/sync/save" \
      -H 'content-type: application/json' \
      --data '{"entryData":{}}'
  )"
  if [[ "$legacy_status" != "410" ]]; then
    echo "Legacy Entry sync is not disabled on staging: HTTP $legacy_status" >&2
    exit 1
  fi
  echo "staging legacy Entry sync disabled."
fi
