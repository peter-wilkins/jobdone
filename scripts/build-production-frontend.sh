#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

FRONTEND_PRODUCTION_ALIAS="${FRONTEND_PRODUCTION_ALIAS:-jobdone.continuumkit.org}"
BACKEND_PRODUCTION_ALIAS="${BACKEND_PRODUCTION_ALIAS:-jobdone-backend-production.vercel.app}"

# shellcheck disable=SC1090
. "${HOME}/.profile"

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: $name" >&2
    exit 1
  fi
}

require_env JOBDONE_PROD_SUPABASE_URL
require_env JOBDONE_PROD_SUPABASE_PUBLISHABLE_KEY

VITE_SUPABASE_URL="$JOBDONE_PROD_SUPABASE_URL" \
  VITE_SUPABASE_ANON_KEY="$JOBDONE_PROD_SUPABASE_PUBLISHABLE_KEY" \
  VITE_APP_URL="https://$FRONTEND_PRODUCTION_ALIAS" \
  VITE_API_URL="https://$BACKEND_PRODUCTION_ALIAS" \
  npx vercel --cwd frontend build --target=production
