#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

FRONTEND_STAGING_ALIAS="${FRONTEND_STAGING_ALIAS:-jobdone-staging.vercel.app}"
FRONTEND_STAGING_LEGACY_ALIAS="${FRONTEND_STAGING_LEGACY_ALIAS:-jobdone-frontend-staging.vercel.app}"
FRONTEND_REMOVED_ALIAS="${FRONTEND_REMOVED_ALIAS:-frontend-jobdone1.vercel.app}"
BACKEND_STAGING_ALIAS="${BACKEND_STAGING_ALIAS:-jobdone-backend-staging.vercel.app}"
OUT_FILE="${OUT_FILE:-.deploy/last-staging.env}"

# shellcheck disable=SC1090
. "${HOME}/.profile"

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: $name" >&2
    exit 1
  fi
}

require_env JOBDONE_STAGING_SUPABASE_DB_URL
require_env JOBDONE_STAGING_SUPABASE_URL
require_env JOBDONE_STAGING_SUPABASE_PUBLISHABLE_KEY

env_file_value() {
  local file="$1"
  local name="$2"
  if [[ ! -f "$file" ]]; then
    return 0
  fi
  grep -E "^${name}=" "$file" | tail -n 1 | cut -d= -f2-
}

extract_deployment_url() {
  grep -Eo 'https://[a-zA-Z0-9.-]+\.vercel\.app' | grep -v 'vercel.com' | tail -n 1
}

deploy_backend() {
  local cors_allowed_origins="https://$FRONTEND_STAGING_ALIAS,https://$FRONTEND_STAGING_LEGACY_ALIAS,http://localhost:5173,http://localhost:4173"
  local shiny_image_provider="${JOBDONE_STAGING_SHINY_IMAGE_PROVIDER:-$(env_file_value "backend/.env" SHINY_IMAGE_PROVIDER)}"
  local shiny_image_model="${JOBDONE_STAGING_SHINY_IMAGE_MODEL:-$(env_file_value "backend/.env" SHINY_IMAGE_MODEL)}"
  local shiny_image_size="${JOBDONE_STAGING_SHINY_IMAGE_SIZE:-$(env_file_value "backend/.env" SHINY_IMAGE_SIZE)}"
  local shiny_image_steps="${JOBDONE_STAGING_SHINY_IMAGE_STEPS:-$(env_file_value "backend/.env" SHINY_IMAGE_STEPS)}"
  local shiny_image_strength="${JOBDONE_STAGING_SHINY_IMAGE_STRENGTH:-$(env_file_value "backend/.env" SHINY_IMAGE_STRENGTH)}"
  local shiny_image_guidance="${JOBDONE_STAGING_SHINY_IMAGE_GUIDANCE:-$(env_file_value "backend/.env" SHINY_IMAGE_GUIDANCE)}"
  local cloudflare_account_id="${JOBDONE_STAGING_CLOUDFLARE_ACCOUNT_ID:-$(env_file_value "backend/.env" CLOUDFLARE_ACCOUNT_ID)}"
  local cloudflare_api_token="${JOBDONE_STAGING_CLOUDFLARE_API_TOKEN:-$(env_file_value "backend/.env" CLOUDFLARE_API_TOKEN)}"
  npx vercel --cwd backend build \
    --target=production \
    >&2
  local output
  output="$(npx vercel --cwd backend deploy \
    --prebuilt \
    --target=production \
    --skip-domain \
    --yes \
    -e SUPABASE_DB_URL="$JOBDONE_STAGING_SUPABASE_DB_URL" \
    -e SUPABASE_URL="$JOBDONE_STAGING_SUPABASE_URL" \
    -e SUPABASE_KEY="$JOBDONE_STAGING_SUPABASE_PUBLISHABLE_KEY" \
    -e LOCAL_REPLICA_DB_URL="$JOBDONE_STAGING_SUPABASE_DB_URL" \
    -e LOCAL_REPLICA_SCHEMA="jobdone" \
    -e DISABLE_LEGACY_ENTRY_SYNC="true" \
    -e FRONTEND_URL="https://$FRONTEND_STAGING_ALIAS" \
    -e CORS_ALLOWED_ORIGINS="$cors_allowed_origins" \
    -e SHINY_IMAGE_PROVIDER="${shiny_image_provider:-openai}" \
    -e SHINY_IMAGE_MODEL="$shiny_image_model" \
    -e SHINY_IMAGE_SIZE="$shiny_image_size" \
    -e SHINY_IMAGE_STEPS="$shiny_image_steps" \
    -e SHINY_IMAGE_STRENGTH="$shiny_image_strength" \
    -e SHINY_IMAGE_GUIDANCE="$shiny_image_guidance" \
    -e CLOUDFLARE_ACCOUNT_ID="$cloudflare_account_id" \
    -e CLOUDFLARE_API_TOKEN="$cloudflare_api_token" \
    2>&1)"
  printf '%s\n' "$output" >&2
  printf '%s\n' "$output" | extract_deployment_url
}

deploy_frontend() {
  local cwd="$1"
  local os_maps_api_key="${JOBDONE_STAGING_OS_MAPS_API_KEY:-$(env_file_value "$cwd/.env" VITE_OS_MAPS_API_KEY)}"
  local os_maps_layer="${JOBDONE_STAGING_OS_MAPS_LAYER:-$(env_file_value "$cwd/.env" VITE_OS_MAPS_LAYER)}"
  local os_maps_max_zoom="${JOBDONE_STAGING_OS_MAPS_MAX_ZOOM:-$(env_file_value "$cwd/.env" VITE_OS_MAPS_MAX_ZOOM)}"
  VITE_SUPABASE_URL="$JOBDONE_STAGING_SUPABASE_URL" \
    VITE_SUPABASE_ANON_KEY="$JOBDONE_STAGING_SUPABASE_PUBLISHABLE_KEY" \
    VITE_APP_URL="https://$FRONTEND_STAGING_ALIAS" \
    VITE_API_URL="https://$BACKEND_STAGING_ALIAS" \
    VITE_OS_MAPS_API_KEY="$os_maps_api_key" \
    VITE_OS_MAPS_LAYER="${os_maps_layer:-Outdoor_3857}" \
    VITE_OS_MAPS_MAX_ZOOM="${os_maps_max_zoom:-20}" \
    npx vercel --cwd "$cwd" build \
      --target=production \
      >&2
  local output
  output="$(npx vercel --cwd "$cwd" deploy \
    --prebuilt \
    --target=production \
    --skip-domain \
    --yes \
    2>&1)"
  printf '%s\n' "$output" >&2
  printf '%s\n' "$output" | extract_deployment_url
}

mkdir -p "$(dirname "$OUT_FILE")"

echo "Deploying backend to staging..."
backend_url="$(deploy_backend)"
npx vercel alias set "$backend_url" "$BACKEND_STAGING_ALIAS" --cwd backend

echo "Deploying frontend to staging..."
frontend_url="$(deploy_frontend frontend)"
npx vercel alias set "$frontend_url" "$FRONTEND_STAGING_ALIAS" --cwd frontend
npx vercel alias set "$frontend_url" "$FRONTEND_STAGING_LEGACY_ALIAS" --cwd frontend
npx vercel alias remove "$FRONTEND_REMOVED_ALIAS" --cwd frontend --yes >/dev/null 2>&1 || true

cat > "$OUT_FILE" <<EOF
GIT_SHA=$(git rev-parse --short HEAD)
FRONTEND_DEPLOYMENT_URL=$frontend_url
BACKEND_DEPLOYMENT_URL=$backend_url
FRONTEND_STAGING_URL=https://$FRONTEND_STAGING_ALIAS
FRONTEND_STAGING_LEGACY_URL=https://$FRONTEND_STAGING_LEGACY_ALIAS
BACKEND_STAGING_URL=https://$BACKEND_STAGING_ALIAS
CREATED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF

echo "Staging deployed:"
echo "  Frontend: https://$FRONTEND_STAGING_ALIAS"
echo "  Backend:  https://$BACKEND_STAGING_ALIAS"
echo "  Record:   $OUT_FILE"
