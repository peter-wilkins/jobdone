#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

STAGING_FILE="${STAGING_FILE:-.deploy/last-staging.env}"
FRONTEND_PRODUCTION_PRIMARY_ALIAS="${FRONTEND_PRODUCTION_ALIAS:-jobdone.continuumkit.org}"
BACKEND_PRODUCTION_PRIMARY_ALIAS="${BACKEND_PRODUCTION_ALIAS:-jobdone-backend-production.vercel.app}"
FRONTEND_PRODUCTION_ALIASES=(
  "$FRONTEND_PRODUCTION_PRIMARY_ALIAS"
  "shiny-art-shop.continuumkit.org"
  "jobdone-frontend-production.vercel.app"
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

JOBDONE_PROD_BACKEND_DB_URL="${JOBDONE_PROD_BACKEND_DB_URL:-${JOBDONE_PROD_SUPABASE_DB_URL:-}}"

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
  local cors_allowed_origins="https://$FRONTEND_PRODUCTION_PRIMARY_ALIAS,https://shiny-art-shop.continuumkit.org,https://jobdone-frontend-production.vercel.app,http://localhost:5173,http://localhost:4173"
  local shiny_image_provider="${JOBDONE_PROD_SHINY_IMAGE_PROVIDER:-${JOBDONE_STAGING_SHINY_IMAGE_PROVIDER:-}}"
  local shiny_image_model="${JOBDONE_PROD_SHINY_IMAGE_MODEL:-${JOBDONE_STAGING_SHINY_IMAGE_MODEL:-}}"
  local shiny_image_size="${JOBDONE_PROD_SHINY_IMAGE_SIZE:-${JOBDONE_STAGING_SHINY_IMAGE_SIZE:-}}"
  local shiny_image_steps="${JOBDONE_PROD_SHINY_IMAGE_STEPS:-${JOBDONE_STAGING_SHINY_IMAGE_STEPS:-}}"
  local shiny_image_strength="${JOBDONE_PROD_SHINY_IMAGE_STRENGTH:-${JOBDONE_STAGING_SHINY_IMAGE_STRENGTH:-}}"
  local shiny_image_guidance="${JOBDONE_PROD_SHINY_IMAGE_GUIDANCE:-${JOBDONE_STAGING_SHINY_IMAGE_GUIDANCE:-}}"
  local shiny_imagemagick_url="${JOBDONE_PROD_SHINY_IMAGEMAGICK_SERVICE_URL:-${JOBDONE_STAGING_SHINY_IMAGEMAGICK_SERVICE_URL:-}}"
  local shiny_imagemagick_token="${JOBDONE_PROD_SHINY_IMAGEMAGICK_SERVICE_TOKEN:-${JOBDONE_STAGING_SHINY_IMAGEMAGICK_SERVICE_TOKEN:-}}"
  local shiny_imagemagick_timeout="${JOBDONE_PROD_SHINY_IMAGEMAGICK_TIMEOUT_MS:-${JOBDONE_STAGING_SHINY_IMAGEMAGICK_TIMEOUT_MS:-}}"
  local cloudflare_account_id="${JOBDONE_PROD_CLOUDFLARE_ACCOUNT_ID:-${JOBDONE_STAGING_CLOUDFLARE_ACCOUNT_ID:-}}"
  local cloudflare_api_token="${JOBDONE_PROD_CLOUDFLARE_API_TOKEN:-${JOBDONE_STAGING_CLOUDFLARE_API_TOKEN:-}}"
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
    -e LOCAL_REPLICA_DB_URL="$JOBDONE_PROD_BACKEND_DB_URL" \
    -e LOCAL_REPLICA_SCHEMA="jobdone" \
    -e FRONTEND_URL="https://$FRONTEND_PRODUCTION_PRIMARY_ALIAS" \
    -e CORS_ALLOWED_ORIGINS="$cors_allowed_origins" \
    -e SHINY_IMAGE_PROVIDER="${shiny_image_provider:-openai}" \
    -e SHINY_IMAGE_MODEL="$shiny_image_model" \
    -e SHINY_IMAGE_SIZE="$shiny_image_size" \
    -e SHINY_IMAGE_STEPS="$shiny_image_steps" \
    -e SHINY_IMAGE_STRENGTH="$shiny_image_strength" \
    -e SHINY_IMAGE_GUIDANCE="$shiny_image_guidance" \
    -e SHINY_IMAGEMAGICK_SERVICE_URL="$shiny_imagemagick_url" \
    -e SHINY_IMAGEMAGICK_SERVICE_TOKEN="$shiny_imagemagick_token" \
    -e SHINY_IMAGEMAGICK_TIMEOUT_MS="$shiny_imagemagick_timeout" \
    -e CLOUDFLARE_ACCOUNT_ID="$cloudflare_account_id" \
    -e CLOUDFLARE_API_TOKEN="$cloudflare_api_token" \
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
