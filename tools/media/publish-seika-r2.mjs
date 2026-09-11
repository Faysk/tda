import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(import.meta.url);
const sharp = createRequire(require.resolve("next/package.json"))("sharp");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const bucket = "tda-media-public";
const publicBase = "https://media.dnd.faysk.dev";
const maxBytes = 16 * 1024 * 1024;

function fail(code) {
  throw new Error(code);
}

function validatePlan(plan) {
  if (
    plan.schemaVersion !== 1 ||
    plan.packageId !== "seika-antes-do-inverno" ||
    plan.identity?.stableId !== "seika" ||
    plan.identity?.kind !== "editorial-lore" ||
    plan.identity?.canonical !== true ||
    plan.audience !== "public" ||
    plan.assets?.length !== 26
  ) {
    fail("INVALID_SEIKA_PLAN");
  }

  const names = new Set();
  for (const asset of plan.assets) {
    if (
      names.has(asset.filename) ||
      !/^[a-f0-9]{64}$/.test(asset.sha256) ||
      !Number.isSafeInteger(asset.bytes) ||
      asset.bytes <= 0 ||
      asset.bytes > maxBytes ||
      !Number.isSafeInteger(asset.width) ||
      !Number.isSafeInteger(asset.height) ||
      asset.width <= 0 ||
      asset.height <= 0 ||
      !["image/webp", "image/jpeg"].includes(asset.mime)
    ) {
      fail(`INVALID_SEIKA_ASSET:${asset.filename ?? "unknown"}`);
    }
    names.add(asset.filename);
    const expectedKey = `lore/seika/${asset.sha256}/${asset.filename}`;
    const expectedUrl = `${publicBase}/${expectedKey}`;
    if (
      asset.bucket !== bucket ||
      asset.objectKey !== expectedKey ||
      asset.plannedPublicUrl !== expectedUrl ||
      asset.publicUrl !== null ||
      asset.publicDeliveryStatus !== "not-verified"
    ) {
      fail(`INVALID_SEIKA_DESTINATION:${asset.filename}`);
    }
  }
}

function assetPath(assetsRoot, asset) {
  return asset.filename === "og-seika.jpg"
    ? join(assetsRoot, "assets", asset.filename)
    : join(assetsRoot, "assets", "web", asset.filename);
}

async function inspect(bytes, asset) {
  if (bytes.length !== asset.bytes || hash(bytes) !== asset.sha256) {
    fail(`LOCAL_INTEGRITY_FAILED:${asset.filename}`);
  }
  const meta = await sharp(bytes, {
    failOn: "warning",
    limitInputPixels: 50_000_000,
  }).metadata();
  const expectedFormat = asset.mime === "image/webp" ? "webp" : "jpeg";
  if (
    meta.format !== expectedFormat ||
    meta.width !== asset.width ||
    meta.height !== asset.height ||
    (meta.pages ?? 1) !== 1
  ) {
    fail(`LOCAL_DECODE_FAILED:${asset.filename}`);
  }
  await sharp(bytes, {
    failOn: "warning",
    limitInputPixels: 50_000_000,
  }).stats();
}

async function headOrNull(client, asset) {
  try {
    return await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: asset.objectKey }),
    );
  } catch (error) {
    if (
      error?.$metadata?.httpStatusCode === 404 ||
      error?.name === "NotFound" ||
      error?.name === "NoSuchKey"
    ) {
      return null;
    }
    throw error;
  }
}

async function uploadOne(client, asset, bytes) {
  const head = await headOrNull(client, asset);
  if (head) {
    if (
      head.ContentLength !== asset.bytes ||
      head.ContentType !== asset.mime ||
      head.Metadata?.sha256 !== asset.sha256
    ) {
      fail(`R2_COLLISION:${asset.filename}`);
    }
  } else {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: asset.objectKey,
        Body: bytes,
        ContentType: asset.mime,
        ContentLength: asset.bytes,
        Metadata: { sha256: asset.sha256 },
        CacheControl: "public, max-age=31536000, immutable",
        IfNoneMatch: "*",
      }),
    );
  }

  const result = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: asset.objectKey }),
  );
  const returned = Buffer.from(await result.Body.transformToByteArray());
  if (
    returned.length !== asset.bytes ||
    hash(returned) !== asset.sha256 ||
    result.ContentType !== asset.mime
  ) {
    fail(`R2_READBACK_FAILED:${asset.filename}`);
  }
  return head ? "skipped-identical" : "uploaded";
}

async function verifyPublic(asset) {
  let last;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      const response = await fetch(asset.plannedPublicUrl, {
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      const mime = response.headers.get("content-type")?.split(";")[0].trim();
      if (mime !== asset.mime) throw new Error(`MIME_${mime}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length !== asset.bytes || hash(bytes) !== asset.sha256) {
        throw new Error("PUBLIC_CONTENT_MISMATCH");
      }
      const meta = await sharp(bytes, {
        failOn: "warning",
        limitInputPixels: 50_000_000,
      }).metadata();
      const expectedFormat = asset.mime === "image/webp" ? "webp" : "jpeg";
      if (
        meta.format !== expectedFormat ||
        meta.width !== asset.width ||
        meta.height !== asset.height
      ) {
        throw new Error("PUBLIC_DECODE_MISMATCH");
      }
      await sharp(bytes, {
        failOn: "warning",
        limitInputPixels: 50_000_000,
      }).stats();
      return {
        httpStatus: response.status,
        httpMime: mime,
        publicUrl: asset.plannedPublicUrl,
        publicDeliveryStatus: "verified-public",
        publicDeliveryVerified: true,
      };
    } catch (error) {
      last = error;
      if (attempt < 6) await sleep(attempt * 1500);
    }
  }
  throw new Error(
    `PUBLIC_VERIFY_FAILED:${asset.filename}:${last?.message ?? "unknown"}`,
  );
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      upload: { type: "boolean", default: false },
      "verify-public": { type: "boolean", default: false },
      "assets-dir": { type: "string" },
    },
  });
  if (!values["assets-dir"]) fail("ASSETS_DIR_REQUIRED");
  if (values["verify-public"] && !values.upload) {
    fail("PUBLIC_VERIFY_REQUIRES_UPLOAD_OR_EXISTING_OBJECT_CHECK");
  }

  const plan = JSON.parse(
    await readFile(join(root, "tools/media/seika-r2-plan.json"), "utf8"),
  );
  validatePlan(plan);

  const assetsRoot = resolve(values["assets-dir"]);
  const prepared = [];
  for (const asset of plan.assets) {
    const bytes = await readFile(assetPath(assetsRoot, asset));
    await inspect(bytes, asset);
    prepared.push({ asset, bytes });
  }

  // The entire local set is validated before any remote client is created.
  if (!values.upload) {
    console.log(
      `SEIKA_R2_DRY_RUN_OK ${prepared.length}/${plan.assets.length} bytes=${prepared.reduce((sum, item) => sum + item.bytes.length, 0)}`,
    );
    return;
  }

  for (const key of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]) {
    if (!process.env[key]) fail(`R2_CONFIGURATION_MISSING:${key}`);
  }
  if ((process.env.R2_PUBLIC_BUCKET || bucket) !== bucket) {
    fail("R2_BUCKET_MISMATCH");
  }

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
  });

  const outputDir = resolve(root, ".local");
  const receiptPath = join(outputDir, "seika-r2-publication-receipt.json");
  await mkdir(outputDir, { recursive: true });

  const receipt = {
    schemaVersion: 1,
    packageId: plan.packageId,
    identity: plan.identity,
    bucket,
    publicBase,
    checkedAt: new Date().toISOString(),
    assets: [],
  };

  for (const { asset, bytes } of prepared) {
    const uploadStatus = await uploadOne(client, asset, bytes);
    const publicResult = values["verify-public"]
      ? await verifyPublic(asset)
      : {
          publicUrl: null,
          publicDeliveryStatus: "not-verified",
          publicDeliveryVerified: false,
        };
    receipt.assets.push({
      assetId: asset.assetId,
      role: asset.role,
      filename: asset.filename,
      sha256: asset.sha256,
      bytes: asset.bytes,
      mime: asset.mime,
      width: asset.width,
      height: asset.height,
      bucket,
      objectKey: asset.objectKey,
      readBackVerified: true,
      uploadStatus,
      ...publicResult,
      verifiedAt: values["verify-public"] ? new Date().toISOString() : null,
    });
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    console.log(
      `SEIKA_R2_OBJECT_OK ${asset.filename} ${uploadStatus} public=${publicResult.publicDeliveryStatus}`,
    );
  }

  if (
    values["verify-public"] &&
    (receipt.assets.length !== plan.assets.length ||
      receipt.assets.some(
        (asset) =>
          asset.publicDeliveryStatus !== "verified-public" ||
          asset.readBackVerified !== true ||
          asset.publicDeliveryVerified !== true ||
          asset.httpStatus !== 200,
      ))
  ) {
    fail("INCOMPLETE_SEIKA_PUBLICATION");
  }

  console.log(
    `SEIKA_R2_PUBLICATION_OK ${receipt.assets.length}/${plan.assets.length} bytes=${receipt.assets.reduce((sum, asset) => sum + asset.bytes, 0)} public=${values["verify-public"] ? "verified" : "pending"}`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(`SEIKA_R2_PUBLICATION_FAILED ${error.message}`);
    process.exitCode = 1;
  });
}
