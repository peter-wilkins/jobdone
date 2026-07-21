#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_DIR="$ROOT_DIR/services/shiny-imagemagick"

# shellcheck disable=SC1090
[[ -f "${HOME}/.profile" ]] && . "${HOME}/.profile"

GCP_REGION="${GCP_REGION:-europe-west2}"
GCP_PROJECT_ID="${GCP_PROJECT_ID:-${GOOGLE_CLOUD_PROJECT:-}}"
SERVICE_NAME="${SHINY_IMAGEMAGICK_SERVICE_NAME:-shiny-imagemagick}"
RENDER_TOKEN="${SHINY_IMAGEMAGICK_SERVICE_TOKEN:-}"

if [[ -z "$GCP_PROJECT_ID" ]]; then
  echo "Missing GCP_PROJECT_ID" >&2
  exit 1
fi
if [[ -z "$RENDER_TOKEN" ]]; then
  echo "Missing SHINY_IMAGEMAGICK_SERVICE_TOKEN" >&2
  exit 1
fi

gcloud config set project "$GCP_PROJECT_ID" >/dev/null
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com >/dev/null

gcloud run deploy "$SERVICE_NAME" \
  --source "$SERVICE_DIR" \
  --region "$GCP_REGION" \
  --allow-unauthenticated \
  --min-instances 0 \
  --max-instances 2 \
  --memory 1Gi \
  --cpu 1 \
  --timeout 60 \
  --concurrency 4 \
  --set-env-vars "RENDER_TOKEN=${RENDER_TOKEN},MAX_INPUT_BYTES=12582912,RENDER_TIMEOUT_MS=25000" \
  --format='value(status.url)'
