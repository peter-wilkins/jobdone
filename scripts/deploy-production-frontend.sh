#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

FRONTEND_PRODUCTION_PRIMARY_ALIAS="${FRONTEND_PRODUCTION_ALIAS:-jobdone.continuumkit.org}"
FRONTEND_PRODUCTION_ALIASES=(
  "$FRONTEND_PRODUCTION_PRIMARY_ALIAS"
  "jobdone-frontend-production.vercel.app"
)
FRONTEND_REMOVED_ALIASES=(
  "jobdone-production.vercel.app"
  "frontend-six-sage-63.vercel.app"
  "frontend-peter-wilkins-jobdone1.vercel.app"
  "frontend-jobdone1.vercel.app"
)

extract_deployment_url() {
  grep -Eo 'https://[a-zA-Z0-9.-]+\.vercel\.app' | grep -v 'vercel.com' | tail -n 1
}

bash scripts/build-production-frontend.sh >&2

output="$(npx vercel --cwd frontend deploy \
  --prebuilt \
  --target=production \
  --skip-domain \
  --yes \
  2>&1)"
printf '%s\n' "$output" >&2
frontend_url="$(printf '%s\n' "$output" | extract_deployment_url)"

if [[ -z "$frontend_url" ]]; then
  echo "Could not find frontend deployment URL in Vercel output" >&2
  exit 1
fi

for alias in "${FRONTEND_PRODUCTION_ALIASES[@]}"; do
  npx vercel alias set "$frontend_url" "$alias" --cwd frontend
done
for alias in "${FRONTEND_REMOVED_ALIASES[@]}"; do
  npx vercel alias remove "$alias" --cwd frontend --yes >/dev/null 2>&1 || true
done

echo "Production frontend deployed:"
echo "  Frontend: https://${FRONTEND_PRODUCTION_ALIASES[0]}"
