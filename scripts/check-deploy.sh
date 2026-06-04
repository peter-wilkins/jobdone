#!/usr/bin/env bash
set -euo pipefail

target="${1:-staging}"

case "$target" in
  staging)
    frontend_url="${FRONTEND_STAGING_URL:-https://jobdone-staging.vercel.app}"
    backend_url="${BACKEND_STAGING_URL:-https://jobdone-backend-staging.vercel.app}"
    ;;
  production|prod)
    frontend_url="${FRONTEND_PRODUCTION_URL:-https://jobdone-frontend-production.vercel.app}"
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
