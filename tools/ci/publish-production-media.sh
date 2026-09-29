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

TDA_MEDIA_PUBLIC_CHALLENGE_MODE=staged-next-image node tools/media/pipeline.mjs publish \
  --manifest-dir "$STAGE_DIR" \
  --receipt "$RECEIPT"

CHALLENGE_COUNT="$(
  node --input-type=module - "$RECEIPT" <<'NODE'
import fs from "node:fs";
const receipt = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
process.stdout.write(String(receipt.assets.filter((asset) => asset.publicDeliveryChallenge === true).length));
NODE
)"

if [[ "$CHALLENGE_COUNT" != "0" ]]; then
  [[ -n "${DEPLOYMENT_URL:-}" ]] || {
    echo "::error::Cloudflare challenged public media verification but DEPLOYMENT_URL is unavailable"
    exit 1
  }

  CHALLENGE_LIST=".local/media-public-challenges.txt"
  node --input-type=module - "$RECEIPT" "$CHALLENGE_LIST" <<'NODE'
import fs from "node:fs";
const [receiptPath, outputPath] = process.argv.slice(2);
const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
const urls = receipt.assets
  .filter((asset) => asset.publicDeliveryChallenge === true)
  .map((asset) => asset.publicUrl);
fs.writeFileSync(outputPath, urls.length ? `${urls.join("\n")}\n` : "");
NODE

  VERIFIED_CHALLENGES=".local/media-public-challenges-verified.txt"
  : > "$VERIFIED_CHALLENGES"
  while IFS= read -r PUBLIC_URL; do
    [[ -n "$PUBLIC_URL" ]] || continue
    PROXY_PATH="$(
      node --input-type=module - "$PUBLIC_URL" <<'NODE'
const publicUrl = process.argv[2];
process.stdout.write(`/_next/image?url=${encodeURIComponent(publicUrl)}&w=64&q=75`);
NODE
    )"
    BODY=".local/media-public-proxy-body.bin"
    HEADERS=".local/media-public-proxy-headers.txt"
    STATUS="$(vercel curl "$PROXY_PATH" --deployment "$DEPLOYMENT_URL" --silent --show-error --output "$BODY" --dump-header "$HEADERS" --write-out '%{http_code}')"
    if [[ "$STATUS" != "200" ]]; then
      echo "::error::Staged anonymous image proxy failed for $PUBLIC_URL with HTTP $STATUS"
      exit 1
    fi
    if [[ ! -s "$BODY" ]]; then
      echo "::error::Staged anonymous image proxy returned an empty body for $PUBLIC_URL"
      exit 1
    fi
    if ! tr -d '\r' < "$HEADERS" | grep -Eiq '^content-type:[[:space:]]*image/'; then
      echo "::error::Staged anonymous image proxy did not return image content for $PUBLIC_URL"
      exit 1
    fi
    printf '%s\n' "$PUBLIC_URL" >> "$VERIFIED_CHALLENGES"
    echo "MEDIA_PUBLIC_PROXY_VERIFIED $PUBLIC_URL"
  done < "$CHALLENGE_LIST"

  node --input-type=module - "$RECEIPT" "$VERIFIED_CHALLENGES" <<'NODE'
import fs from "node:fs";
const [receiptPath, verifiedPath] = process.argv.slice(2);
const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
const verified = new Set(fs.readFileSync(verifiedPath, "utf8").split(/\r?\n/u).filter(Boolean));
for (const asset of receipt.assets) {
  if (asset.publicDeliveryChallenge !== true) continue;
  if (!verified.has(asset.publicUrl)) {
    throw new Error(`Missing staged proxy verification for ${asset.file}`);
  }
  asset.publicDeliveryVerified = true;
  asset.publicDeliveryVerificationMode = "staged-next-image";
}
receipt.summary.verified = receipt.assets.filter((asset) => asset.publicDeliveryVerified === true).length;
fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
NODE
fi

SUMMARY_LINE="$(
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
)"
read -r ASSETS PUBLISHED REUSED VERIFIED <<< "$SUMMARY_LINE"

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
