#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

STAGING_FILE="${STAGING_FILE:-.deploy/last-staging.env}"
FRONTEND_PRODUCTION_ALIASES=(
  "${FRONTEND_PRODUCTION_ALIAS:-jobdone-production.vercel.app}"
  "jobdone-frontend-production.vercel.app"
  "frontend-six-sage-63.vercel.app"
  "frontend-jobdone1.vercel.app"
  "frontend-peter-wilkins-jobdone1.vercel.app"
)
BACKEND_PRODUCTION_ALIASES=(
  "${BACKEND_PRODUCTION_ALIAS:-jobdone-backend-production.vercel.app}"
  "jobdone-gamma.vercel.app"
  "jobdone-jobdone1.vercel.app"
  "jobdone-peter-wilkins-jobdone1.vercel.app"
)

if [[ ! -f "$STAGING_FILE" ]]; then
  echo "Missing $STAGING_FILE. Run npm run deploy:staging first." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$STAGING_FILE"
set +a

if [[ -z "${FRONTEND_DEPLOYMENT_URL:-}" || -z "${BACKEND_DEPLOYMENT_URL:-}" ]]; then
  echo "$STAGING_FILE does not contain deployment URLs." >&2
  exit 1
fi

echo "Promoting staged deployment $GIT_SHA to production aliases..."
for alias in "${BACKEND_PRODUCTION_ALIASES[@]}"; do
  npx vercel alias set "$BACKEND_DEPLOYMENT_URL" "$alias" --cwd backend
done
for alias in "${FRONTEND_PRODUCTION_ALIASES[@]}"; do
  npx vercel alias set "$FRONTEND_DEPLOYMENT_URL" "$alias" --cwd frontend
done

echo "Production promoted:"
echo "  Frontend: https://${FRONTEND_PRODUCTION_ALIASES[0]}"
echo "  Backend:  https://${BACKEND_PRODUCTION_ALIASES[0]}"
