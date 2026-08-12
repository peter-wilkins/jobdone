#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${IMAGE:-jobdone-shiny-playground:gmic-4.0.3}"
PORT="${PORT:-8098}"
SOURCE_IMAGE="${SOURCE_IMAGE:-/home/peter/Downloads/dog.jpg}"
WINDMILL_SOURCE_IMAGE="${WINDMILL_SOURCE_IMAGE:-/tmp/jobdone-marquetry/cley-windmill.jpg}"
WOOD_SAMPLE_DIR="${WOOD_SAMPLE_DIR:-/home/peter/Pictures/marquerty/handsome-grain}"
AMMONITE_ASSET_DIR="${AMMONITE_ASSET_DIR:-/home/peter/cnc-workshop-tools/local/ammonite-target}"
OUT_DIR="${OUT_DIR:-/tmp/jobdone-imagemagick-playground-docker}"

mkdir -p "$OUT_DIR"

docker run --rm -it \
  --user "$(id -u):$(id -g)" \
  -p "$PORT:8097" \
  -v "$ROOT:/workspace" \
  -v "$(dirname "$SOURCE_IMAGE"):/input/dogs:ro" \
  -v "$(dirname "$WINDMILL_SOURCE_IMAGE"):/input/windmills:ro" \
  -v "$WOOD_SAMPLE_DIR:/input/wood-samples:ro" \
  -v "$AMMONITE_ASSET_DIR:/input/ammonites:ro" \
  -v "$OUT_DIR:/out" \
  -e PORT=8097 \
  -e DOG_SOURCE_IMAGE="/input/dogs/$(basename "$SOURCE_IMAGE")" \
  -e WINDMILL_SOURCE_IMAGE="/input/windmills/$(basename "$WINDMILL_SOURCE_IMAGE")" \
  -e WOOD_SAMPLE_DIR=/input/wood-samples \
  -e AMMONITE_ASSET_DIR=/input/ammonites \
  -e OUT_DIR=/out \
  -e MAGICK_BIN=convert \
  -e GMIC_BIN=gmic \
  "$IMAGE"
