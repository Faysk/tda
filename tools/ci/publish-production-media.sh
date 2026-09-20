#!/usr/bin/env bash
set -euo pipefail

RANGE="${1:?git range is required}"
STAGE_DIR=".local/production-media-manifests"
RECEIPT=".local/media-production-publication-receipt.json"

emit_outputs() {
  local assets="$1"
  local published="$2"
  local reused="$3"
  local verified="$4"
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    {
      echo "assets=$assets"
      echo "published=$published"
      echo "reused=$reused"
      echo "verified=$verified"
    } >> "$GITHUB_OUTPUT"
  fi
}

rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"

mapfile -t MANIFESTS < <(
  git diff --name-only --diff-filter=ACMR "$RANGE" -- 'media/manifests/*.json' | LC_ALL=C sort -u
)

if [[ ${#MANIFESTS[@]} -eq 0 ]]; then
  emit_outputs 0 0 0 0
  echo "MEDIA_PUBLISH_SKIP no changed canonical manifests in $RANGE"
  exit 0
fi

for manifest in "${MANIFESTS[@]}"; do
  cp "$manifest" "$STAGE_DIR/$(basename "$manifest")"
done

node tools/media/pipeline.mjs publish \
  --manifest-dir "$STAGE_DIR" \
  --receipt "$RECEIPT"

read -r ASSETS PUBLISHED REUSED VERIFIED < <(
  node --input-type=module - "$RECEIPT" <<'NODE'
import fs from "node:fs";

const receiptPath = process.argv[2];
const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
const summary = receipt.summary;
for (const field of ["assets", "published", "reused", "verified"]) {
  if (!Number.isInteger(summary?.[field]) || summary[field] < 0) {
    throw new Error(`Invalid media receipt summary field ${field}`);
  }
}
if (summary.assets !== summary.published + summary.reused) {
  throw new Error("Media receipt action counts do not match asset count");
}
if (summary.verified !== summary.assets) {
  throw new Error("Media receipt does not verify every selected asset");
}
process.stdout.write(
  [summary.assets, summary.published, summary.reused, summary.verified].join(" "),
);
NODE
)

emit_outputs "$ASSETS" "$PUBLISHED" "$REUSED" "$VERIFIED"

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo "## Media Storage publication"
    echo "- Range: `$RANGE`"
    echo "- Manifests: `${#MANIFESTS[@]}`"
    echo "- Assets: `$ASSETS`"
    echo "- Published: `$PUBLISHED`"
    echo "- Reused: `$REUSED`"
    echo "- Public verified: `$VERIFIED`"
  } >> "$GITHUB_STEP_SUMMARY"
fi

echo "MEDIA_PUBLISH_CHANGED_OK manifests=${#MANIFESTS[@]} assets=$ASSETS published=$PUBLISHED reused=$REUSED verified=$VERIFIED range=$RANGE"
