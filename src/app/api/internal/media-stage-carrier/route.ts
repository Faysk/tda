import { createHash } from "node:crypto";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PUBLIC_BUCKET = "tda-media-public";
const PUBLIC_ORIGIN = "https://media.dnd.faysk.dev";
const MAX_CARRIER_BYTES = 2 * 1024 * 1024;

const assets = {
  "yllith-hq.avif": {
    bytes: 270660,
    sha256: "80f34c65d49c46eea9abc77b689dbc3a35db6169833942023cc77a3b2e2b732c",
  },
  "yllith-jornada-hq.avif": {
    bytes: 145395,
    sha256: "696815188f4bf602c1b288b7b8f7f2741373e52055fbe06ba7cccb44b591784c",
  },
  "despedida-pais-hq.avif": {
    bytes: 206324,
    sha256: "15eed32a0da97d8303e3390d7792293b51af11cce6a98338f59f85f360605036",
  },
  "despedida-tios-hq.avif": {
    bytes: 232976,
    sha256: "1640491d2fe6dc6d90636f0e05d013bfae013f39b2fd3449e96e24c77ff4baec",
  },
  "sonho-hq.avif": {
    bytes: 76358,
    sha256: "c5899e7ee7b1154c5db8bd3d6b58b8a120d5527317dc101ef613139fbe902d70",
  },
  "mapa-hq.avif": {
    bytes: 329394,
    sha256: "4516fd1fcaa6d97f56369007bfb5ddd320427e5a53bb850a8e9a267b7051e73a",
  },
  "jornada-hq.avif": {
    bytes: 244263,
    sha256: "febe6350fb80ea3c7a84b76ee5673f44365d231d7729ccdae57c0fedaaebd834",
  },
  "horizonte-hq.avif": {
    bytes: 238231,
    sha256: "95c30d52b452ef0560a755fdbcb1138b5e9066cd3dfa2496b03d30d350681197",
  },
} as const;

type AssetName = keyof typeof assets;

function isAssetName(value: string | null): value is AssetName {
  return Boolean(value && value in assets);
}

function configured() {
  return Boolean(
    process.env.R2_PUBLIC_BUCKET === PUBLIC_BUCKET &&
      process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY,
  );
}

function s3Client() {
  return new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function objectKey(name: AssetName) {
  return `lore/yllith/${assets[name].sha256}/${name}`;
}

function publicUrl(name: AssetName) {
  return `${PUBLIC_ORIGIN}/${objectKey(name)}`;
}

function trustedSource(value: string) {
  const url = new URL(value);
  return (
    url.protocol === "https:" &&
    url.hostname.startsWith("oaisdmntpr") &&
    url.hostname.endsWith(".blob.core.windows.net") &&
    url.pathname.startsWith("/files/") &&
    url.pathname.endsWith("/raw")
  );
}

function extractCarrierPayload(carrier: Buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (carrier.length < 20 || !carrier.subarray(0, 8).equals(signature)) {
    throw new Error("carrier is not PNG");
  }

  let offset = 8;
  const payloads: Buffer[] = [];
  while (offset + 12 <= carrier.length) {
    const length = carrier.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = typeStart + 4;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (chunkEnd > carrier.length) throw new Error("truncated PNG carrier");
    const type = carrier.toString("ascii", typeStart, dataStart);
    if (type === "raVF") payloads.push(carrier.subarray(dataStart, dataEnd));
    offset = chunkEnd;
    if (type === "IEND") break;
  }

  if (payloads.length !== 1) throw new Error("carrier must contain exactly one raVF chunk");
  return Buffer.from(payloads[0]);
}

function json(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(data, { ...init, headers });
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const name = requestUrl.searchParams.get("asset");
  const source = requestUrl.searchParams.get("source");

  if (!name && !source) {
    return json({
      environment: process.env.APP_ENV ?? null,
      configured: configured(),
      policy: "preview-only fixed immutable AVIF carrier staging",
      assets: Object.entries(assets).map(([asset, spec]) => ({
        asset,
        bytes: spec.bytes,
        sha256: spec.sha256,
        url: `${PUBLIC_ORIGIN}/lore/yllith/${spec.sha256}/${asset}`,
      })),
    });
  }

  if (process.env.APP_ENV !== "preview") {
    return json({ error: "preview-only staging endpoint" }, { status: 404 });
  }
  if (!configured()) {
    return json({ error: "R2 configuration unavailable" }, { status: 503 });
  }
  if (!isAssetName(name) || !source) {
    return json({ error: "asset and source are required" }, { status: 400 });
  }

  let allowed = false;
  try {
    allowed = trustedSource(source);
  } catch {
    allowed = false;
  }
  if (!allowed) return json({ error: "untrusted carrier source" }, { status: 400 });

  const response = await fetch(source, { cache: "no-store", redirect: "follow" });
  if (!response.ok) {
    return json({ error: "carrier fetch failed", status: response.status }, { status: 502 });
  }
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_CARRIER_BYTES) {
    return json({ error: "carrier too large" }, { status: 413 });
  }
  const carrier = Buffer.from(await response.arrayBuffer());
  if (carrier.length > MAX_CARRIER_BYTES) {
    return json({ error: "carrier too large" }, { status: 413 });
  }

  let payload: Buffer;
  try {
    payload = extractCarrierPayload(carrier);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "invalid carrier" }, { status: 422 });
  }

  const spec = assets[name];
  const digest = sha256(payload);
  if (payload.length !== spec.bytes || digest !== spec.sha256) {
    return json(
      {
        error: "AVIF integrity mismatch",
        expectedBytes: spec.bytes,
        actualBytes: payload.length,
        expectedSha256: spec.sha256,
        actualSha256: digest,
      },
      { status: 422 },
    );
  }

  const client = s3Client();
  const key = objectKey(name);
  await client.send(
    new PutObjectCommand({
      Bucket: PUBLIC_BUCKET,
      Key: key,
      Body: payload,
      ContentType: "image/avif",
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
  const head = await client.send(new HeadObjectCommand({ Bucket: PUBLIC_BUCKET, Key: key }));
  if (head.ContentLength !== spec.bytes || head.ContentType !== "image/avif") {
    return json({ error: "R2 read-back metadata mismatch" }, { status: 502 });
  }

  return json({
    ok: true,
    asset: name,
    bytes: payload.length,
    sha256: digest,
    key,
    url: publicUrl(name),
  });
}
