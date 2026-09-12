import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const TEMPLATE_PATH = path.join(ROOT, "public", "lore", "d", "index.html");
const OUTPUT_DIR = path.join(ROOT, "public", "lore", "d", "generated");
const MANIFEST_PATH = path.join(ROOT, "src", "config", "published-lore-media.json");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertDMedia(media) {
  const required = ["d-completo", "d-sem-sobretudo", "d-sem-chapeu"];
  for (const id of required) {
    const asset = media[id];
    if (!asset) throw new Error(`Missing canonical D media entry: ${id}`);
    if (asset.mime !== "image/png") {
      throw new Error(`${id}: expected image/png, got ${asset.mime}`);
    }
    if (asset.width !== 1024 || asset.height !== 1536) {
      throw new Error(`${id}: expected 1024x1536 canonical master`);
    }
    if (!/^[a-f0-9]{64}$/.test(asset.sha256)) {
      throw new Error(`${id}: invalid sha256`);
    }
    const url = new URL(asset.url);
    if (url.protocol !== "https:" || url.hostname !== "media.dnd.faysk.dev") {
      throw new Error(`${id}: canonical URL must use media.dnd.faysk.dev over HTTPS`);
    }
    if (!url.pathname.includes(`/${asset.sha256}/`)) {
      throw new Error(`${id}: canonical URL is not content-addressed by sha256`);
    }
  }
}

export async function materializeDLorePage() {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  const media = manifest.d;
  assertDMedia(media);

  let html = await readFile(TEMPLATE_PATH, "utf8");

  for (const [id, asset] of Object.entries(media)) {
    const imagePattern = new RegExp(
      `<img\\s+src="[^"]*"\\s+data-d-image="${escapeRegExp(id)}"`,
      "g",
    );
    const buttonPattern = new RegExp(
      `(data-d-image="${escapeRegExp(id)}"\\s+data-image=")[^"]*(")`,
      "g",
    );

    html = html.replace(
      imagePattern,
      `<img src="${asset.url}" width="${asset.width}" height="${asset.height}" data-artwork-quality="master" data-d-image="${id}"`,
    );
    html = html.replace(buttonPattern, `$1${asset.url}$2`);
  }

  if (html.includes("data:image/")) {
    throw new Error("Generated D page still contains data:image placeholders");
  }
  if (/\.b64(?:["'?#]|$)/.test(html)) {
    throw new Error("Generated D page still references Base64 transport files");
  }

  for (const id of Object.keys(media)) {
    if (!html.includes(`data-d-image="${id}"`)) {
      throw new Error(`Generated D page lost artwork binding: ${id}`);
    }
    if (!html.includes(media[id].url)) {
      throw new Error(`Generated D page does not contain canonical URL for ${id}`);
    }
  }

  await rm(OUTPUT_DIR, { recursive: true, force: true });
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(path.join(OUTPUT_DIR, "index.html"), html, "utf8");
  await writeFile(
    path.join(OUTPUT_DIR, "media-manifest.json"),
    `${JSON.stringify({ source: "published-lore-media", assets: media }, null, 2)}\n`,
    "utf8",
  );

  console.log("[media] D page materialized with canonical R2 PNG masters");
  return media;
}

const invokedAsScript = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  : false;

if (invokedAsScript) {
  await materializeDLorePage();
}
