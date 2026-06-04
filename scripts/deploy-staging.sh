#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

FRONTEND_STAGING_ALIAS="${FRONTEND_STAGING_ALIAS:-jobdone-frontend-staging.vercel.app}"
BACKEND_STAGING_ALIAS="${BACKEND_STAGING_ALIAS:-jobdone-backend-staging.vercel.app}"
OUT_FILE="${OUT_FILE:-.deploy/last-staging.env}"

extract_deployment_url() {
  grep -Eo 'https://[a-zA-Z0-9.-]+\.vercel\.app' | grep -v 'vercel.com' | tail -n 1
}

deploy_prebuilt() {
  local cwd="$1"
  npx vercel --cwd "$cwd" build
  local output
  output="$(npx vercel --cwd "$cwd" deploy --prebuilt --yes 2>&1)"
  printf '%s\n' "$output" >&2
  printf '%s\n' "$output" | extract_deployment_url
}

mkdir -p "$(dirname "$OUT_FILE")"

echo "Deploying backend to staging..."
backend_url="$(deploy_prebuilt backend)"
npx vercel alias set "$backend_url" "$BACKEND_STAGING_ALIAS" --cwd backend

echo "Deploying frontend to staging..."
frontend_url="$(deploy_prebuilt frontend)"
npx vercel alias set "$frontend_url" "$FRONTEND_STAGING_ALIAS" --cwd frontend

cat > "$OUT_FILE" <<EOF
GIT_SHA=$(git rev-parse --short HEAD)
FRONTEND_DEPLOYMENT_URL=$frontend_url
BACKEND_DEPLOYMENT_URL=$backend_url
FRONTEND_STAGING_URL=https://$FRONTEND_STAGING_ALIAS
BACKEND_STAGING_URL=https://$BACKEND_STAGING_ALIAS
CREATED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF

echo "Staging deployed:"
echo "  Frontend: https://$FRONTEND_STAGING_ALIAS"
echo "  Backend:  https://$BACKEND_STAGING_ALIAS"
echo "  Record:   $OUT_FILE"
