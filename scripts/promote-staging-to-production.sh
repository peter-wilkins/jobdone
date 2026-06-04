#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

STAGING_FILE="${STAGING_FILE:-.deploy/last-staging.env}"
FRONTEND_PRODUCTION_PRIMARY_ALIAS="${FRONTEND_PRODUCTION_ALIAS:-jobdone-frontend-production.vercel.app}"
BACKEND_PRODUCTION_PRIMARY_ALIAS="${BACKEND_PRODUCTION_ALIAS:-jobdone-backend-production.vercel.app}"
FRONTEND_PRODUCTION_ALIASES=(
  "$FRONTEND_PRODUCTION_PRIMARY_ALIAS"
)
FRONTEND_REMOVED_ALIASES=(
  "jobdone-production.vercel.app"
  "frontend-six-sage-63.vercel.app"
  "frontend-peter-wilkins-jobdone1.vercel.app"
  "frontend-jobdone1.vercel.app"
)
BACKEND_PRODUCTION_ALIASES=(
  "$BACKEND_PRODUCTION_PRIMARY_ALIAS"
  "jobdone-gamma.vercel.app"
  "jobdone-jobdone1.vercel.app"
  "jobdone-peter-wilkins-jobdone1.vercel.app"
)

# shellcheck disable=SC1090
. "${HOME}/.profile"

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: $name" >&2
    exit 1
  fi
}

require_env JOBDONE_PROD_BACKEND_DB_URL
require_env JOBDONE_PROD_SUPABASE_URL
require_env JOBDONE_PROD_SUPABASE_PUBLISHABLE_KEY

if [[ ! -f "$STAGING_FILE" ]]; then
  echo "Missing $STAGING_FILE. Run npm run deploy:staging first." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$STAGING_FILE"
set +a

extract_deployment_url() {
  grep -Eo 'https://[a-zA-Z0-9.-]+\.vercel\.app' | grep -v 'vercel.com' | tail -n 1
}

deploy_backend() {
  npx vercel --cwd backend build \
    --target=production \
    >&2
  local output
  output="$(npx vercel --cwd backend deploy \
    --prebuilt \
    --target=production \
    --skip-domain \
    --yes \
    -e SUPABASE_DB_URL="$JOBDONE_PROD_BACKEND_DB_URL" \
    -e SUPABASE_URL="$JOBDONE_PROD_SUPABASE_URL" \
    -e SUPABASE_KEY="$JOBDONE_PROD_SUPABASE_PUBLISHABLE_KEY" \
    -e FRONTEND_URL="https://$FRONTEND_PRODUCTION_PRIMARY_ALIAS" \
    2>&1)"
  printf '%s\n' "$output" >&2
  printf '%s\n' "$output" | extract_deployment_url
}

deploy_frontend() {
  VITE_SUPABASE_URL="$JOBDONE_PROD_SUPABASE_URL" \
    VITE_SUPABASE_ANON_KEY="$JOBDONE_PROD_SUPABASE_PUBLISHABLE_KEY" \
    VITE_APP_URL="https://$FRONTEND_PRODUCTION_PRIMARY_ALIAS" \
    VITE_API_URL="https://$BACKEND_PRODUCTION_PRIMARY_ALIAS" \
    npx vercel --cwd frontend build \
      --target=production \
      >&2
  local output
  output="$(npx vercel --cwd frontend deploy \
    --prebuilt \
    --target=production \
    --skip-domain \
    --yes \
    2>&1)"
  printf '%s\n' "$output" >&2
  printf '%s\n' "$output" | extract_deployment_url
}

echo "Building production deployment from commit $GIT_SHA with production environment..."
BACKEND_DEPLOYMENT_URL="$(deploy_backend)"
FRONTEND_DEPLOYMENT_URL="$(deploy_frontend)"

echo "Promoting production deployment $GIT_SHA to production aliases..."
for alias in "${BACKEND_PRODUCTION_ALIASES[@]}"; do
  npx vercel alias set "$BACKEND_DEPLOYMENT_URL" "$alias" --cwd backend
done
for alias in "${FRONTEND_PRODUCTION_ALIASES[@]}"; do
  npx vercel alias set "$FRONTEND_DEPLOYMENT_URL" "$alias" --cwd frontend
done
for alias in "${FRONTEND_REMOVED_ALIASES[@]}"; do
  npx vercel alias remove "$alias" --cwd frontend --yes >/dev/null 2>&1 || true
done

echo "Production promoted:"
echo "  Frontend: https://${FRONTEND_PRODUCTION_ALIASES[0]}"
echo "  Backend:  https://${BACKEND_PRODUCTION_ALIASES[0]}"
