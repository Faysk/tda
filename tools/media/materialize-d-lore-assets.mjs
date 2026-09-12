import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SOURCE_DIR = path.join(ROOT, "public", "lore", "d", "assets");
const GENERATED_DIR = path.join(SOURCE_DIR, "generated");

const PRIMARY = [
  {
    id: "d-completo",
    source: "d-completo-hq.avif.b64",
    output: "d-completo.avif",
    mime: "image/avif",
    width: 1024,
    height: 1536,
  },
  {
    id: "d-sem-sobretudo",
    source: "d-sem-sobretudo-hq.avif.b64",
    output: "d-sem-sobretudo.avif",
    mime: "image/avif",
    width: 1024,
    height: 1536,
  },
  {
    id: "d-sem-chapeu",
    source: "d-sem-chapeu-hq.avif.b64",
    output: "d-sem-chapeu.avif",
    mime: "image/avif",
    width: 1024,
    height: 1536,
  },
];

const FALLBACK = [
  {
    id: "d-completo",
    parts: [
      "base64/d-completo-fixed.0.b64",
      "base64/d-completo-fixed.1.b64",
      "base64/d-completo-fixed.2.b64",
    ],
    output: "d-completo-fallback.png",
    mime: "image/png",
  },
  {
    id: "d-sem-sobretudo",
    parts: [
      "base64/d-sem-sobretudo.0.b64",
      "base64/d-sem-sobretudo.1.b64",
      "base64/d-sem-sobretudo.2.b64",
    ],
    output: "d-sem-sobretudo-fallback.avif",
    mime: "image/avif",
  },
  {
    id: "d-sem-chapeu",
    parts: [
      "base64/d-sem-chapeu-fixed.0.b64",
      "base64/d-sem-chapeu-fixed.1.b64",
      "base64/d-sem-chapeu-fixed.2.b64",
    ],
    output: "d-sem-chapeu-fallback.png",
    mime: "image/png",
  },
];

function decodeBase64(text, label) {
  const normalized = text.replace(/\s+/g, "");
  if (!normalized || normalized.length % 4 !== 0) {
    throw new Error(`${label}: invalid base64 length`);
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new Error(`${label}: invalid base64 characters`);
  }
  return Buffer.from(normalized, "base64");
}

function avifDimensions(buffer, label) {
  const ftyp = buffer.subarray(4, 12).toString("ascii");
  if (!ftyp.startsWith("ftyp")) {
    throw new Error(`${label}: not an ISO-BMFF image`);
  }
  const ispe = buffer.indexOf(Buffer.from("ispe"));
  if (ispe < 0 || ispe + 16 > buffer.length) {
    throw new Error(`${label}: AVIF is missing ispe dimensions`);
  }
  return {
    width: buffer.readUInt32BE(ispe + 8),
    height: buffer.readUInt32BE(ispe + 12),
  };
}

function pngDimensions(buffer, label) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buffer.subarray(0, 8).equals(signature) || buffer.length < 24) {
    throw new Error(`${label}: invalid PNG signature`);
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function dimensions(buffer, mime, label) {
  if (mime === "image/avif") return avifDimensions(buffer, label);
  if (mime === "image/png") return pngDimensions(buffer, label);
  throw new Error(`${label}: unsupported mime ${mime}`);
}

function digest(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function readSingle(source) {
  const raw = await readFile(path.join(SOURCE_DIR, source), "utf8");
  return decodeBase64(raw, source);
}

async function readParts(parts) {
  const chunks = await Promise.all(
    parts.map(async (part) => readFile(path.join(SOURCE_DIR, part), "utf8")),
  );
  return decodeBase64(chunks.join(""), parts.join(" + "));
}

async function writeAsset(spec, buffer, kind) {
  const measured = dimensions(buffer, spec.mime, spec.output);
  if (spec.width && measured.width !== spec.width) {
    throw new Error(
      `${spec.output}: expected width ${spec.width}, got ${measured.width}`,
    );
  }
  if (spec.height && measured.height !== spec.height) {
    throw new Error(
      `${spec.output}: expected height ${spec.height}, got ${measured.height}`,
    );
  }

  await writeFile(path.join(GENERATED_DIR, spec.output), buffer);
  return {
    id: spec.id,
    kind,
    file: spec.output,
    mime: spec.mime,
    bytes: buffer.length,
    width: measured.width,
    height: measured.height,
    sha256: digest(buffer),
  };
}

export async function materializeDLoreAssets() {
  await rm(GENERATED_DIR, { recursive: true, force: true });
  await mkdir(GENERATED_DIR, { recursive: true });

  const manifest = [];
  for (const spec of PRIMARY) {
    manifest.push(await writeAsset(spec, await readSingle(spec.source), "primary"));
  }
  for (const spec of FALLBACK) {
    manifest.push(await writeAsset(spec, await readParts(spec.parts), "fallback"));
  }

  await writeFile(
    path.join(GENERATED_DIR, "manifest.json"),
    `${JSON.stringify({ generatedAtBuild: true, assets: manifest }, null, 2)}\n`,
    "utf8",
  );

  for (const asset of manifest.filter((item) => item.kind === "primary")) {
    console.log(
      `[media] ${asset.file}: ${asset.width}x${asset.height}, ${asset.bytes} bytes, sha256=${asset.sha256}`,
    );
  }

  return manifest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await materializeDLoreAssets();
}
