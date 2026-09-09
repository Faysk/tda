import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const STAGING_DIR = ".asset-staging/pipipi";
const OUTPUT_DIR = "public/lore/pipipi";
const CHUNK_COUNT = 28;
const TAR_SHA256 = "00ddfe8a39c93ba9ef22860e682f2ba5dd350b0ae08446b04ee404d0168e4900";
const BASE64_SHA256 = "9f1e364a6855e1327bce0ca7e4927f31a88a63bedc92f2a6f0c70862d202fdd1";
const ASSET_SHA256 = {
  "acordou-bg.avif": "d84758bdb7346d657bfc86743fd56a6c48eccf5f33672d192d34cca641a3f298",
  "acordou-subject.avif": "a66fe6a195760c5a8a4c4cee48a8f4d17053665fa9235137fb34a61b0960f927",
  "cadeira-bg.avif": "207c942dfed018dff17fc9aa4b8beb7a76927d43067ab88d49d80153c90e0a2f",
  "cadeira-subject.avif": "c4c4d981c788a49001d05c2db938328c730a3eb318781eee6b68dc0ab2c882db",
  "casa-bg.avif": "cbe176037452e2589a562fdde210716b8adbcbc0bc6396fcbd6a65aad8010ec7",
  "casa-subject.avif": "40f2cc8ad204073451d2fd5ede3127669d02dcf5f6534cd9f41047d6d437103d",
  "corredores-bg.avif": "335797f3e8843437d860b308618b5b2223b20f59dddac8993aa58c31cf7b15c6",
  "corredores-subject.avif": "90983edad17841a6032b73a8787c5b601d1c0864ed834ad31aa6ab668fdab095",
  "ghost-cry.avif": "da1281f73885795761f97140fd956e021aa4a22972ea8887bcab4ddfb579f4ac",
  "ghost-flute.avif": "aebecc0f75b94c4ee4d29a4971cb97f39b3f71eb981c98dd1ce78e893d784f67",
  "ghost-hearts.avif": "03590553887cea9673ac6a301035a787bff6bd46118d7ed3a77bf6dc4d55587a",
  "ghost-soft.avif": "0e05ab0b8739683d8c27863c7fd78d02f5c4ff537a420030618650b97e5a20b7",
  "ghost-surprise.avif": "253dfd63b8a4a7a622bcd806d7634658b716e139791ca922f03a4ffbe288c217",
  "stage-bg.avif": "28db4c5af4b2ffeef66c4ede09ad370d49c24fe127e17cde9a0203f02670a188",
  "super-bg.avif": "609ff28c82e76067feafcc957b3d1b47bbb408b205791f4dd1010ce72f874972",
  "super-subject.avif": "4a5ea1e8616fece1f0f60587a95d7102ea01f4e5f6c34ad4d4c712952ff0f6f7",
  "ultimo-dia-bg.avif": "1f714a6fabfacf7950ecfed53659ea7499d6efea477fec66d229380992448c47",
  "ultimo-dia-subject.avif": "2d5155d4a4f2ce2816ad654d98d6a27268144fdf48e5603ff609e642fadbaac9"
};

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function readTarString(buffer, start, length) {
  return buffer.subarray(start, start + length).toString("utf8").replace(/\0.*$/s, "").trim();
}

function readTarOctal(buffer, start, length) {
  const raw = readTarString(buffer, start, length).trim();
  if (!raw) return 0;
  if (!/^[0-7]+$/.test(raw)) throw new Error(`Invalid tar octal field: ${raw}`);
  return Number.parseInt(raw, 8);
}

function parseTar(tar) {
  const entries = new Map();
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;

    const name = readTarString(header, 0, 100);
    const size = readTarOctal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 48);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;

    if (!name || dataEnd > tar.length) throw new Error(`Invalid tar entry at offset ${offset}`);
    if (type !== "0" && type !== "\0") throw new Error(`Unexpected tar entry type ${type} for ${name}`);
    if (basename(name) !== name || name.includes("..") || name.includes("/") || name.includes("\\")) {
      throw new Error(`Unsafe tar path: ${name}`);
    }
    if (!(name in ASSET_SHA256)) throw new Error(`Unexpected Pipipi asset in bundle: ${name}`);
    if (entries.has(name)) throw new Error(`Duplicate Pipipi asset in bundle: ${name}`);

    entries.set(name, Buffer.from(tar.subarray(dataStart, dataEnd)));
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

async function main() {
  const chunkNames = (await readdir(STAGING_DIR))
    .filter((name) => /^\d{3}\.txt$/.test(name))
    .sort();

  const expectedChunkNames = Array.from({ length: CHUNK_COUNT }, (_, index) => `${String(index).padStart(3, "0")}.txt`);
  if (JSON.stringify(chunkNames) !== JSON.stringify(expectedChunkNames)) {
    throw new Error(`Pipipi staging chunks invalid. Expected ${CHUNK_COUNT} sequential chunks, got ${chunkNames.length}.`);
  }

  const parts = [];
  for (const name of chunkNames) {
    parts.push((await readFile(join(STAGING_DIR, name), "utf8")).trim());
  }
  const base64 = parts.join("");
  if (sha256(Buffer.from(base64, "utf8")) !== BASE64_SHA256) {
    throw new Error("Pipipi base64 bundle SHA-256 mismatch.");
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new Error("Pipipi staging bundle is not valid base64.");
  }

  const tar = Buffer.from(base64, "base64");
  if (sha256(tar) !== TAR_SHA256) {
    throw new Error("Pipipi tar bundle SHA-256 mismatch.");
  }

  const entries = parseTar(tar);
  const expectedNames = Object.keys(ASSET_SHA256).sort();
  const actualNames = [...entries.keys()].sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new Error(`Pipipi bundle asset set mismatch. Expected ${expectedNames.length}, got ${actualNames.length}.`);
  }

  await mkdir(OUTPUT_DIR, { recursive: true });
  const existing = await readdir(OUTPUT_DIR);
  for (const name of existing) {
    if (name.endsWith(".avif")) await rm(join(OUTPUT_DIR, name));
  }

  for (const name of expectedNames) {
    const bytes = entries.get(name);
    const actualSha = sha256(bytes);
    if (actualSha !== ASSET_SHA256[name]) {
      throw new Error(`Pipipi asset SHA-256 mismatch for ${name}: expected ${ASSET_SHA256[name]}, got ${actualSha}`);
    }
    await writeFile(join(OUTPUT_DIR, name), bytes);
  }

  console.log(`Pipipi assets ready: ${expectedNames.length} AVIF files.`);
}

await main();
