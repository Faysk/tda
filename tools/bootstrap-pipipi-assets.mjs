import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const BUNDLE_PATH = ".asset-bundles/pipipi-runtime-v4.tar";
const OUTPUT_DIR = "public/lore/pipipi";
const TAR_SHA256 = "004856faeee6913abc82de080cec097d0065dc770c3017fca6d98f550495e0ec";
const ASSET_SHA256 = {
  "acordou-bg.avif": "39f409991b7ceb198637333153bd457ab9338a6405e54c79974db54bf24cf982",
  "acordou-subject.avif": "3db06b2a8216576452e99cc5d485b9d4e5da4fee7f28ff64856b507ef4d1ec9d",
  "cadeira-bg.avif": "5a5a0f4281b46824c4302a815fafff452734d4e1f2908fb4ac4734c88887a26a",
  "cadeira-subject.avif": "1b9678741fa029ed6c76c84d91f9abdcdc94b91d7b7c44ab40886f9b367c0752",
  "casa-bg.avif": "a2e400c56b9e18db51f06213d211e7ed81118a2675a89feaf460bb5bdb2a1959",
  "casa-subject.avif": "a3ea5b4cad8cccbe90ed01ad7306436639995120c6bddee01638ca113f647820",
  "corredores-bg.avif": "50b5c88cf596b7f8c6d434abc7065df7af9c458710fce82a6c1fecd4f080cd23",
  "corredores-subject.avif": "2fb0164a92fd12008f53e42e9433212d4787d3d788dc05cd017c662693235b13",
  "ghost-cry.avif": "381de7c9a2cd8163891c081ee04f2893f2caa82f5f2d9d88b70e350320d4ae92",
  "ghost-flute.avif": "135c4fa5a20fd7447d1470944b2a8fc1ce7e8ea69944ae886d9c3bf3d0c23611",
  "ghost-hearts.avif": "38ba8074b24a7cf0fc7448d5b13684eadecd785ec07935568654d15170dec84f",
  "ghost-soft.avif": "cd04c7e3fbbc647fbf44d18f9b76778a1d31c3b6f56a447cce99aa0a6a437272",
  "ghost-surprise.avif": "4b73eff366efc85b47fdaffcca30d99cf392f21e8c498549dc6a2cc7036ac5ce",
  "stage-bg.avif": "a50beeeb7b598aaab89dc74e3e5cec0787df63092bf8a5487f9e450d3228f816",
  "super-bg.avif": "c372648d38ce17fe1dd3eb70fe4d7a038f13278930f8001efca875b57e889a7d",
  "super-subject.avif": "0613f27dd4dc910835fe293198ba8a04aaa69f06566c05f034154b2d2aeb720b",
  "ultimo-dia-bg.avif": "4f5fdf9203746e4a32592ba924a3ea4a4ec7c98ef8104050a5ec635ea929ae44",
  "ultimo-dia-subject.avif": "b4be9868ca7af9e31caebe4dfe9939d32c784c8d69455af3fb940b0dfa8cd00a"
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
  const tar = await readFile(BUNDLE_PATH);
  if (sha256(tar) !== TAR_SHA256) {
    throw new Error("Pipipi runtime bundle SHA-256 mismatch.");
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
