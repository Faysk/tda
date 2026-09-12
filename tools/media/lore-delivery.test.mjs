import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { materializeDLorePage } from "./materialize-d-lore-page.mjs";

test("D page materializes canonical R2 PNG masters before Next builds", async () => {
  const media = await materializeDLorePage();
  const html = await readFile(
    new URL("../../public/lore/d/generated/index.html", import.meta.url),
    "utf8",
  );
  const script = await readFile(
    new URL("../../public/lore/d/script.js", import.meta.url),
    "utf8",
  );

  assert.equal(Object.keys(media).length, 3);
  assert.doesNotMatch(html, /data:image\//);
  assert.doesNotMatch(html, /\.b64(?:["'?#]|$)/);
  assert.doesNotMatch(script, /\.b64|data:image|fetchText|buildAssetUrl|hydrateCharacterImage/);

  for (const [id, asset] of Object.entries(media)) {
    assert.equal(asset.mime, "image/png");
    assert.equal(asset.width, 1024);
    assert.equal(asset.height, 1536);
    assert.match(asset.sha256, /^[a-f0-9]{64}$/);
    assert.ok(asset.url.startsWith("https://media.dnd.faysk.dev/lore/d/"));
    assert.ok(asset.url.includes(`/${asset.sha256}/`));
    assert.ok(html.includes(asset.url), `${id} URL missing from generated HTML`);
    assert.ok(html.includes(`data-d-image="${id}"`));
  }
});

test("Seika aliases stream real WebP bytes instead of redirecting", async () => {
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
  assert.match(route, /X-TDA-Media-SHA256/);
});
