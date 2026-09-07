import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import {
	S3Client,
	HeadObjectCommand,
	GetObjectCommand,
	PutObjectCommand,
} from "@aws-sdk/client-s3";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
// Use Next's existing optional decoder; fail closed if not installed. No transformation is saved.
const sharp = createRequire(require.resolve("next/package.json"))("sharp");
export const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const bucket = "tda-media-public";
const maxBytes = 16 * 1024 * 1024;
const fail = (code) => {
	throw Object.assign(Error(code), { name: "RecoveryError" });
};

export function validateSources(input) {
	if (
		input.schemaVersion !== 1 ||
		input.campaign !== "yuhara-main" ||
		!/^[a-f0-9]{40}$/.test(input.sourceCommit) ||
		input.images?.length !== 22
	)
		fail("INVALID_INVENTORY");
	const sessions = new Map();
	for (const row of input.images) {
		if (
			!/^[a-f0-9-]{36}$/.test(row.sessionId) ||
			!row.sourceSessionId ||
			!["cover", "hero"].includes(row.role)
		)
			fail("INVALID_IDENTITY");
		const roles = sessions.get(row.sessionId) ?? new Set();
		if (roles.has(row.role)) fail("DUPLICATE_ROLE");
		roles.add(row.role);
		sessions.set(row.sessionId, roles);
		if (
			!/^[a-f0-9]{64}$/.test(row.expected?.sha256) ||
			!Number.isSafeInteger(row.expected?.bytes) ||
			row.expected.bytes <= 0 ||
			row.expected.bytes > maxBytes
		)
			fail("INVALID_EXPECTED_CONTENT");
		const original = new URL(row.originalUrl),
			source = new URL(row.resolvedSourceUrl);
		for (const url of [original, source])
			if (
				url.protocol !== "https:" ||
				url.username ||
				url.password ||
				url.search ||
				url.hash ||
				url.port
			)
				fail("UNSAFE_SOURCE_URL");
		const filename = row.role === "cover" ? "card" : "hero";
		const suffix = `/web/assets/sessions/${row.sessionDate}/${filename}.webp`;
		if (row.sourceKind === "github") {
			if (
				source.href !==
				`https://raw.githubusercontent.com/Faysk/dnd-scribe/${input.sourceCommit}${suffix}`
			)
				fail("SOURCE_ASSOCIATION_MISMATCH");
			const legacy = `https://dnd.faysk.dev/assets/sessions/${row.sessionDate}/${filename}.webp`;
			const raw = `https://raw.githubusercontent.com/Faysk/dnd-scribe/refs/heads/codex/local-first-production${suffix}`;
			if (![legacy, raw].includes(original.href))
				fail("ORIGINAL_ASSOCIATION_MISMATCH");
		} else if (row.sourceKind === "supabase-storage") {
			const prefix = `https://dmrqnbdvbkfqzctcerbx.supabase.co/storage/v1/object/public/session-images/yuhara-main/${row.sessionId}/${row.role}-`;
			if (
				!source.href.startsWith(prefix) ||
				!source.href.endsWith(".webp") ||
				source.href !== original.href
			)
				fail("SOURCE_ASSOCIATION_MISMATCH");
		} else fail("UNSUPPORTED_SOURCE");
	}
	if (
		sessions.size !== 11 ||
		[...sessions.values()].some((roles) => roles.size !== 2)
	)
		fail("INCOMPLETE_PAIRS");
}

export async function inspectImage(bytes) {
	if (!bytes.length || bytes.length > maxBytes) fail("INVALID_SIZE");
	const webp =
		bytes.toString("ascii", 0, 4) === "RIFF" &&
		bytes.toString("ascii", 8, 12) === "WEBP";
	const png = bytes
		.subarray(0, 8)
		.equals(Buffer.from("89504e470d0a1a0a", "hex"));
	if (!webp && !png) fail("INVALID_IMAGE_CONTAINER");
	if (webp && bytes.readUInt32LE(4) + 8 !== bytes.length)
		fail("INVALID_WEBP_CONTAINER");
	const decoder = sharp(bytes, {
		failOn: "warning",
		limitInputPixels: 40_000_000,
	});
	const metadata = await decoder.metadata();
	if (
		!["webp", "png"].includes(metadata.format) ||
		!metadata.width ||
		!metadata.height ||
		(metadata.pages ?? 1) !== 1
	)
		fail("INVALID_IMAGE");
	await decoder.stats(); // Force full decoding; a plausible header alone is insufficient.
	return {
		mime: `image/${metadata.format}`,
		extension: metadata.format,
		bytes: bytes.length,
		width: metadata.width,
		height: metadata.height,
		sha256: hash(bytes),
	};
}

export function assertExpected(image, info) {
	for (const key of ["sha256", "bytes", "mime", "width", "height"])
		if (image.expected[key] !== info[key]) fail("SOURCE_CONTENT_CHANGED");
}

export async function download(url, fetcher = fetch) {
	const response = await fetcher(url, {
		redirect: "error",
		signal: AbortSignal.timeout(30_000),
	});
	if (!response.ok) fail(`SOURCE_HTTP_${response.status}`);
	const mime = response.headers.get("content-type")?.split(";")[0].trim();
	if (!["image/webp", "image/png", "application/octet-stream"].includes(mime))
		fail("SOURCE_MIME_REJECTED");
	if (Number(response.headers.get("content-length")) > maxBytes)
		fail("SOURCE_TOO_LARGE");
	const parts = [];
	let size = 0;
	for await (const part of response.body) {
		size += part.length;
		if (size > maxBytes) fail("SOURCE_TOO_LARGE");
		parts.push(part);
	}
	return Buffer.concat(parts);
}

export function assertLiveAssociations(input, rows) {
	if (rows.length !== 11) fail("LIVE_SESSION_COUNT_CHANGED");
	for (const image of input.images) {
		const row = rows.find((item) => item.id === image.sessionId);
		if (
			!row ||
			row.source_session_id !== image.sourceSessionId ||
			row.session_date !== image.sessionDate ||
			row[image.role] !== image.originalUrl
		)
			fail("LIVE_ASSOCIATION_CHANGED");
	}
}

async function verifyDatabase(input) {
	if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY)
		fail("SUPABASE_CONFIGURATION_MISSING");
	const db = createClient(
		process.env.SUPABASE_URL,
		process.env.SUPABASE_SECRET_KEY,
		{ auth: { persistSession: false, autoRefreshToken: false } },
	);
	const { data, error } = await db
		.from("sessions")
		.select(
			"id,source_session_id,session_date,cover:metadata->>coverImageUrl,hero:metadata->>heroImageUrl,campaigns!inner(slug)",
		)
		.eq("status", "published")
		.eq("campaigns.slug", "yuhara-main");
	if (error) fail("SUPABASE_READ_FAILED");
	assertLiveAssociations(input, data);
}

export async function preserveLocal(path, bytes) {
	try {
		const previous = await readFile(path);
		if (!previous.equals(bytes)) fail("LOCAL_COLLISION");
		return "skip";
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	// Exclusive creation preserves concurrent writers and previously recovered originals.
	try {
		await writeFile(path, bytes, { flag: "wx" });
	} catch (error) {
		if (error.code !== "EEXIST") throw error;
		return preserveLocal(path, bytes);
	}
	return "saved";
}

export async function processObject(
	client,
	image,
	bytes,
	{ upload = false } = {},
) {
	if (hash(bytes) !== image.sha256 || bytes.length !== image.bytes)
		fail("LOCAL_INTEGRITY_FAILED");
	const request = { Bucket: bucket, Key: image.objectKey };
	let head;
	try {
		head = await client.send(new HeadObjectCommand(request));
	} catch (error) {
		if (
			error.$metadata?.httpStatusCode !== 404 ||
			!["NotFound", "NoSuchKey"].includes(error.name)
		)
			throw error;
	}
	if (head) {
		if (
			head.ContentLength !== image.bytes ||
			head.ContentType !== image.mime ||
			head.Metadata?.sha256 !== image.sha256
		)
			fail("R2_COLLISION");
	} else if (!upload)
		return {
			uploadStatus: "not-uploaded",
			verificationStatus: "local-verified",
			r2Status: "absent",
		};
	else {
		// Close the HEAD/PUT race: never overwrite an object created by another writer.
		await client.send(
			new PutObjectCommand({
				...request,
				Body: bytes,
				ContentType: image.mime,
				ContentLength: image.bytes,
				Metadata: { sha256: image.sha256 },
				CacheControl: "public, max-age=31536000, immutable",
				IfNoneMatch: "*",
			}),
		);
	}
	const result = await client.send(new GetObjectCommand(request));
	const returned = Buffer.from(await result.Body.transformToByteArray());
	if (
		returned.length !== image.bytes ||
		hash(returned) !== image.sha256 ||
		result.ContentType !== image.mime
	)
		fail("R2_READBACK_FAILED");
	return {
		uploadStatus: head ? "skipped-identical" : "uploaded",
		verificationStatus: "r2-readback-verified",
		r2Status: "identical",
	};
}

function r2Client() {
	for (const key of [
		"R2_ACCOUNT_ID",
		"R2_ACCESS_KEY_ID",
		"R2_SECRET_ACCESS_KEY",
	])
		if (!process.env[key]) fail("R2_CONFIGURATION_MISSING");
	if (process.env.R2_PUBLIC_BUCKET !== bucket) fail("R2_BUCKET_MISMATCH");
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

export async function main(args = process.argv.slice(2)) {
	const { values } = parseArgs({
		args,
		options: {
			upload: { type: "boolean", default: false },
			"check-r2": { type: "boolean", default: false },
			"verify-db": { type: "boolean", default: false },
			output: { type: "string", default: join(root, ".local/session-media") },
		},
		strict: true,
	});
	const input = JSON.parse(
		await readFile(
			join(root, "tools/media/session-image-sources.json"),
			"utf8",
		),
	);
	validateSources(input);
	if (values.upload && !values["verify-db"])
		fail("UPLOAD_REQUIRES_LIVE_ASSOCIATIONS");
	if (values["verify-db"]) await verifyDatabase(input);
	const output = resolve(values.output);
	await mkdir(join(output, "originals"), { recursive: true });
	const manifest = {
		schemaVersion: 1,
		observedAt: new Date().toISOString(),
		mode: values.upload ? "upload" : "dry-run",
		campaign: input.campaign,
		sourceCommit: input.sourceCommit,
		associations: values["verify-db"] ? "live-verified" : "snapshot-only",
		images: [],
		failures: [],
	};
	const client = values.upload || values["check-r2"] ? r2Client() : null;
	const checkpoint = async () => {
		const path = join(output, "manifest.json");
		await writeFile(`${path}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`);
		await rename(`${path}.tmp`, path);
	};
	for (const source of input.images) {
		let phase = "download";
		try {
			const bytes = await download(source.resolvedSourceUrl);
			phase = "decode-and-pin";
			const info = await inspectImage(bytes);
			assertExpected(source, info);
			const image = {
				...source,
				...info,
				visibility: "public-intended",
				bucket,
				objectKey: `campaigns/yuhara-main/sessions/${source.sessionId}/${source.role}/${info.sha256}.${info.extension}`,
				localPath: `originals/${info.sha256}.${info.extension}`,
				uploadStatus: "not-uploaded",
				verificationStatus: "local-verified",
				r2Status: "not-checked",
				publicUrl: null,
				publicDeliveryStatus: "not-verified",
			};
			phase = "preserve-local";
			await preserveLocal(join(output, image.localPath), bytes);
			manifest.images.push(image);
			phase = "r2";
			if (client)
				Object.assign(
					image,
					await processObject(client, image, bytes, { upload: values.upload }),
				);
			await checkpoint();
			console.log(
				`RECOVERED ${source.sessionId} ${source.role} ${info.bytes} ${image.r2Status}`,
			);
		} catch (error) {
			// Never serialize SDK/fetch error objects: they may contain credential-bearing requests.
			manifest.failures.push({
				sessionId: source.sessionId,
				role: source.role,
				status: "failed",
				phase,
				code:
					error.name === "RecoveryError" ? error.message : "OPERATION_FAILED",
			});
			await checkpoint();
			fail(`RECOVERY_FAILED_${source.sessionId}_${source.role}`);
		}
	}
	console.log(
		`MEDIA_RECOVERY_OK ${manifest.images.length}/22 bytes=${manifest.images.reduce((sum, row) => sum + row.bytes, 0)} mode=${manifest.mode}`,
	);
	return manifest;
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	main().catch(() => {
		console.error(
			"MEDIA_RECOVERY_FAILED: inspect manifest failures; no references promoted",
		);
		process.exitCode = 1;
	});
}
