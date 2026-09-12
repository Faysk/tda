import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { materializeDLoreAssets } from "./materialize-d-lore-assets.mjs";

test("D delivery assets are materialized as real 1024x1536 images", async () => {
  const manifest = await materializeDLoreAssets();
  const primary = manifest.filter((asset) => asset.kind === "primary");

  assert.equal(primary.length, 3);
  for (const asset of primary) {
    assert.equal(asset.mime, "image/avif");
    assert.equal(asset.width, 1024);
    assert.equal(asset.height, 1536);
    assert.ok(asset.bytes > 0);
    assert.match(asset.sha256, /^[a-f0-9]{64}$/);
  }
});

test("D generated HTML contains direct binary image URLs before Next builds", async () => {
  await materializeDLoreAssets();
  const html = await readFile(
    new URL("../../public/lore/d/generated/index.html", import.meta.url),
    "utf8",
  );
  const script = await readFile(
    new URL("../../public/lore/d/script.js", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(html, /data:image\//);
  assert.match(html, /src="\/lore\/d\/assets\/generated\/d-completo\.avif"/);
  assert.match(html, /data-artwork-quality="hq"/);
  assert.match(html, /data-fallback-image="\/lore\/d\/assets\/generated\//);

  assert.doesNotMatch(script, /\.b64/);
  assert.doesNotMatch(script, /data:image\//);
  assert.doesNotMatch(script, /buildAssetUrl|fetchText|hydrateCharacterImage/);
});

test("Seika media route returns verified image bytes instead of redirect aliases", async () => {
  const route = await readFile(
    new URL(
      "../../src/app/lore/seika/assets/web/[file]/route.ts",
      import.meta.url,
    ),
    "utf8",
  );

  assert.doesNotMatch(route, /Response\.redirect/);
  assert.match(route, /await fetch\(media\.url/);
  assert.match(route, /upstreamMime !== media\.mime/);
  assert.match(route, /"Content-Type": media\.mime/);
  assert.match(route, /mime: "image\/webp"/);
});
