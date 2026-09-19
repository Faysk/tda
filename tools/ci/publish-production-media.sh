#!/usr/bin/env bash
set -euo pipefail

RANGE="${1:?git range is required}"
MEDIA_ENV="${2:-}"
STAGE_DIR=".local/production-media-manifests"
RECEIPT=".local/media-production-publication-receipt.json"

rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"

mapfile -t MANIFESTS < <(
  git diff --name-only --diff-filter=ACMR "$RANGE" -- 'media/manifests/*.json' | LC_ALL=C sort -u
)

if [[ ${#MANIFESTS[@]} -eq 0 ]]; then
  echo "MEDIA_PUBLISH_SKIP no changed canonical manifests in $RANGE"
  exit 0
fi

for manifest in "${MANIFESTS[@]}"; do
  cp "$manifest" "$STAGE_DIR/$(basename "$manifest")"
done

if [[ -n "$MEDIA_ENV" ]]; then
  [[ -f "$MEDIA_ENV" ]] || { echo "MEDIA_PUBLISH_FAILED env file not found"; exit 1; }
  node --env-file="$MEDIA_ENV" tools/media/pipeline.mjs publish \
    --manifest-dir "$STAGE_DIR" \
    --receipt "$RECEIPT"
else
  node tools/media/pipeline.mjs publish \
    --manifest-dir "$STAGE_DIR" \
    --receipt "$RECEIPT"
fi

echo "MEDIA_PUBLISH_CHANGED_OK manifests=${#MANIFESTS[@]} range=$RANGE"
