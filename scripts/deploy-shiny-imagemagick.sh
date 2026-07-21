#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_DIR="$ROOT_DIR/services/shiny-imagemagick"
cd "$ROOT_DIR"

# shellcheck disable=SC1090
[[ -f "${HOME}/.profile" ]] && . "${HOME}/.profile"

GCP_REGION="${GCP_REGION:-europe-west2}"
GCP_PROJECT_ID="${GCP_PROJECT_ID:-${GOOGLE_CLOUD_PROJECT:-}}"
SERVICE_NAME="${SHINY_IMAGEMAGICK_SERVICE_NAME:-shiny-imagemagick}"
RENDER_TOKEN="${SHINY_IMAGEMAGICK_SERVICE_TOKEN:-}"
TAG="${SHINY_IMAGEMAGICK_IMAGE_TAG:-$(git rev-parse --short HEAD)}"
REPOSITORY="${SHINY_IMAGEMAGICK_ARTIFACT_REPOSITORY:-cloud-run-source-deploy}"
IMAGE="${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${REPOSITORY}/${SERVICE_NAME}:${TAG}"

if [[ -z "$GCP_PROJECT_ID" ]]; then
  echo "Missing GCP_PROJECT_ID" >&2
  exit 1
fi
if [[ -z "$RENDER_TOKEN" ]]; then
  echo "Missing SHINY_IMAGEMAGICK_SERVICE_TOKEN" >&2
  exit 1
fi

gcloud config set project "$GCP_PROJECT_ID" >/dev/null
gcloud services enable run.googleapis.com artifactregistry.googleapis.com >/dev/null

if ! gcloud artifacts repositories describe "$REPOSITORY" --location "$GCP_REGION" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$REPOSITORY" \
    --repository-format=docker \
    --location "$GCP_REGION" \
    --description="JobDone Shiny container images" \
    >/dev/null
fi

gcloud auth configure-docker "${GCP_REGION}-docker.pkg.dev" --quiet >/dev/null
docker build --platform linux/amd64 -t "$IMAGE" "$SERVICE_DIR"
docker push "$IMAGE"

gcloud run deploy "$SERVICE_NAME" \
  --image "$IMAGE" \
  --region "$GCP_REGION" \
  --allow-unauthenticated \
  --min-instances 0 \
  --max-instances 2 \
  --memory 1Gi \
  --cpu 1 \
  --timeout 60 \
  --concurrency 4 \
  --set-env-vars "RENDER_TOKEN=${RENDER_TOKEN},MAGICK_BIN=convert,MAX_INPUT_BYTES=12582912,RENDER_TIMEOUT_MS=25000" \
  --format='value(status.url)'
