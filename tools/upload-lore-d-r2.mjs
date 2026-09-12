import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const BUCKET = "tda-media-public";
const PUBLIC_ORIGIN = "https://media.dnd.faysk.dev";
const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");

const EXPECTED = {
  completo: {
    filename: "d-completo.png",
    sha256: "9d751c8d81fed971540e35a249c9804c434467004c9c21d858f24900adab77de",
    bytes: 3968158,
    width: 1024,
    height: 1536,
  },
  "sem-sobretudo": {
    filename: "d-sem-sobretudo.png",
    sha256: "69f12023e3e3deaa489ffab303bad555dde46218588e83697044a4c18753c2d5",
    bytes: 2533930,
    width: 1024,
    height: 1536,
  },
  "sem-chapeu": {
    filename: "d-sem-chapeu.png",
    sha256: "28504455959c820eef86c93b260cdfb45ed1e75e37db40309477dc69acdba3e7",
    bytes: 2510711,
    width: 1024,
    height: 1536,
  },
};

function fail(code) {
  throw Object.assign(new Error(code), { name: "LoreDMediaError" });
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function inspectPng(bytes) {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    fail("INVALID_PNG");
  }
  if (bytes.toString("ascii", 12, 16) !== "IHDR") fail("INVALID_PNG_IHDR");
  return {
    bytes: bytes.length,
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    sha256: sha256(bytes),
    mime: "image/png",
  };
}

function assertExpected(name, bytes) {
  const expected = EXPECTED[name];
  const actual = inspectPng(bytes);
  for (const key of ["sha256", "bytes", "width", "height"]) {
    if (actual[key] !== expected[key]) fail(`SOURCE_MISMATCH_${name}_${key}`);
  }
  return actual;
}

function objectKey(expected) {
  return `lore/d/${expected.sha256}/${expected.filename}`;
}

function clientFromEnv() {
  for (const key of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]) {
    if (!process.env[key]) fail("R2_CONFIGURATION_MISSING");
  }
  if (process.env.R2_PUBLIC_BUCKET !== BUCKET) fail("R2_BUCKET_MISMATCH");
  return new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
}

async function getObjectBytes(client, key) {
  const result = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return {
    bytes: Buffer.from(await result.Body.transformToByteArray()),
    contentType: result.ContentType,
    metadata: result.Metadata ?? {},
  };
}

async function uploadOne(client, name, sourcePath, upload) {
  const expected = EXPECTED[name];
  const bytes = await readFile(resolve(sourcePath));
  const info = assertExpected(name, bytes);
  const key = objectKey(expected);
  const request = { Bucket: BUCKET, Key: key };

  let head = null;
  try {
    head = await client.send(new HeadObjectCommand(request));
  } catch (error) {
    if (error?.$metadata?.httpStatusCode !== 404 && error?.name !== "NotFound" && error?.name !== "NoSuchKey") {
      throw error;
    }
  }

  if (head) {
    if (
      head.ContentLength !== expected.bytes ||
      head.ContentType !== "image/png" ||
      head.Metadata?.sha256 !== expected.sha256
    ) {
      fail(`R2_COLLISION_${name}`);
    }
  } else if (!upload) {
    fail(`R2_OBJECT_ABSENT_${name}`);
  } else {
    await client.send(
      new PutObjectCommand({
        ...request,
        Body: bytes,
        ContentType: "image/png",
        ContentLength: expected.bytes,
        CacheControl: "public, max-age=31536000, immutable",
        Metadata: {
          sha256: expected.sha256,
          width: String(expected.width),
          height: String(expected.height),
          source: "d-lore-original-png",
        },
        IfNoneMatch: "*",
      }),
    );
  }

  const readback = await getObjectBytes(client, key);
  if (
    readback.bytes.length !== expected.bytes ||
    sha256(readback.bytes) !== expected.sha256 ||
    readback.contentType !== "image/png"
  ) {
    fail(`R2_READBACK_FAILED_${name}`);
  }

  const url = `${PUBLIC_ORIGIN}/${key}`;
  let publicOk = false;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
    if (response.ok) {
      const publicBytes = Buffer.from(await response.arrayBuffer());
      const publicMime = response.headers.get("content-type")?.split(";")[0]?.trim();
      if (
        publicBytes.length === expected.bytes &&
        sha256(publicBytes) === expected.sha256 &&
        publicMime === "image/png"
      ) {
        publicOk = true;
        break;
      }
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1500));
  }
  if (!publicOk) fail(`PUBLIC_DELIVERY_FAILED_${name}`);

  console.log(`R2_OK ${name} ${expected.bytes} ${expected.sha256} ${url}`);
  return { name, key, url, ...info };
}

async function main() {
  const { values } = parseArgs({
    options: {
      completo: { type: "string" },
      "sem-sobretudo": { type: "string" },
      "sem-chapeu": { type: "string" },
      upload: { type: "boolean", default: false },
    },
    strict: true,
  });

  if (!values.upload) fail("EXPLICIT_UPLOAD_FLAG_REQUIRED");
  for (const key of ["completo", "sem-sobretudo", "sem-chapeu"]) {
    if (!values[key]) fail(`SOURCE_PATH_REQUIRED_${key}`);
  }

  const client = clientFromEnv();
  const results = [];
  for (const key of ["completo", "sem-sobretudo", "sem-chapeu"]) {
    results.push(await uploadOne(client, key, values[key], true));
  }

  console.log(`D_LORE_R2_UPLOAD_OK ${results.length}/3 original-png exact-bytes verified-public`);
}

main().catch((error) => {
  const code = error?.name === "LoreDMediaError" ? error.message : "OPERATION_FAILED";
  console.error(`D_LORE_R2_UPLOAD_FAILED ${code}`);
  process.exitCode = 1;
});
