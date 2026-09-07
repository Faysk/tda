import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { S3Client } from "@aws-sdk/client-s3";
import { hash, processObject } from "../migrate-session-media-r2.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const selected = {
	"pipipi-lore-premium": [
		"pipipi",
		"casa",
		"corredores",
		"super_herois",
		"cadeira",
		"ultimo_dia",
		"acordou",
	],
	parallax_art_demo: [
		"00-sky",
		"01-mountains",
		"02-castle",
		"03-fog-back",
		"04-crowd",
		"05-hero",
		"06-foreground",
		"07-fog-front",
	],
};

export function validateLorePlan(plan) {
	if (plan.schemaVersion !== 1 || plan.packages?.length !== 2)
		throw Error("Invalid packages");
	const seen = new Set();
	for (const pack of plan.packages) {
		const allowed = selected[pack.packageId];
		if (
			!allowed ||
			seen.has(pack.packageId) ||
			pack.assets.length !== allowed.length
		)
			throw Error("Invalid asset scope");
		const demoIdentity = pack.packageId === "parallax_art_demo";
		if (
			pack.identity?.entityUuid !== null ||
			pack.identity?.stableId !==
				(demoIdentity ? "parallax-art-demo-v1" : "pipipi") ||
			pack.identity?.kind !==
				(demoIdentity ? "technical-demo" : "editorial-lore") ||
			(demoIdentity && pack.identity.canonical !== false)
		)
			throw Error("Unapproved canonical identity");
		seen.add(pack.packageId);
		const assetSet = hash(
			Buffer.from(
				[...pack.assets]
					.sort((a, b) => a.filename.localeCompare(b.filename))
					.map((a) => `${a.filename}:${a.sha256}`)
					.join("\n"),
			),
		);
		if (assetSet !== pack.assetSetSha256) throw Error("Asset set changed");
		const names = new Set();
		for (const a of pack.assets) {
			const demo = pack.packageId === "parallax_art_demo";
			const ext = demo ? "svg" : "webp";
			if (!allowed.includes(a.assetId) || names.has(a.assetId))
				throw Error("Unexpected asset identity");
			names.add(a.assetId);
			if (
				!/^[a-f0-9]{64}$/.test(a.sha256) ||
				a.filename !== `${a.assetId}.${ext}` ||
				a.localPath !== `${pack.packageId}/${a.filename}` ||
				a.mime !== (demo ? "image/svg+xml" : "image/webp")
			)
				throw Error("Invalid file identity");
			if (demo && a.svgValidation !== "static-profile-local-references-only")
				throw Error("Unreviewed SVG");
			const key = demo
				? `demos/parallax-art-demo-v1/${assetSet}/assets/${a.filename}`
				: `lore/pipipi/${a.sha256}/${a.filename}`;
			if (
				a.bucket !== "tda-media-public" ||
				a.objectKey !== key ||
				a.publicUrl !== null ||
				a.publicDeliveryStatus !== "not-verified"
			)
				throw Error("Unapproved destination or promotion");
			if (
				!Number.isSafeInteger(a.bytes) ||
				a.bytes <= 0 ||
				a.bytes > 16 * 1024 * 1024 ||
				!Number.isSafeInteger(a.width) ||
				!Number.isSafeInteger(a.height) ||
				a.width <= 0 ||
				a.height <= 0
			)
				throw Error("Invalid image measurement");
		}
	}
}

export async function stage(args = process.argv.slice(2)) {
	const { values } = parseArgs({
		args,
		strict: true,
		options: {
			upload: { type: "boolean", default: false },
			"check-r2": { type: "boolean", default: false },
			package: { type: "string" },
			"assets-dir": {
				type: "string",
				default: join(root, ".local/lore-assets"),
			},
		},
	});
	if (values.package && !selected[values.package])
		throw Error("Unknown package");
	if (values.upload && !values.package)
		throw Error("Upload requires one explicit package");
	const manifest = JSON.parse(
		await readFile(
			join(
				root,
				"docs/integrations/evidence/lore-assets-prepared-2026-09-07.json",
			),
			"utf8",
		),
	);
	validateLorePlan(manifest);
	const assets = manifest.packages
		.filter((p) => !values.package || p.packageId === values.package)
		.flatMap((p) => p.assets);
	// Validate every local byte before creating a remote client or issuing the first write.
	const binaries = await Promise.all(
		assets.map(async (a) => {
			const bytes = await readFile(
				join(resolve(values["assets-dir"]), a.localPath),
			);
			if (hash(bytes) !== a.sha256 || bytes.length !== a.bytes)
				throw Error("Local asset integrity failed");
			return bytes;
		}),
	);
	let client;
	if (values.upload || values["check-r2"]) {
		if (
			process.env.R2_PUBLIC_BUCKET !== "tda-media-public" ||
			!process.env.R2_ACCOUNT_ID ||
			!process.env.R2_ACCESS_KEY_ID ||
			!process.env.R2_SECRET_ACCESS_KEY
		)
			throw Error("R2 configuration missing");
		client = new S3Client({
			region: "auto",
			endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
			credentials: {
				accessKeyId: process.env.R2_ACCESS_KEY_ID,
				secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
			},
			requestChecksumCalculation: "WHEN_REQUIRED",
		});
	}
	const receipt = {
		mode: values.upload ? "upload" : "dry-run",
		checkedAt: new Date().toISOString(),
		publicDeliveryStatus: "not-verified",
		assets: [],
	};
	for (const [index, asset] of assets.entries()) {
		const status = client
			? await processObject(client, asset, binaries[index], {
					upload: values.upload,
				})
			: {
					uploadStatus: "not-uploaded",
					verificationStatus: "local-verified",
					r2Status: "not-checked",
				};
		receipt.assets.push({
			objectKey: asset.objectKey,
			sha256: asset.sha256,
			bytes: asset.bytes,
			...status,
		});
		await writeFile(
			join(root, `.local/lore-stage-${values.package ?? "all"}.json`),
			`${JSON.stringify(receipt, null, 2)}\n`,
		);
	}
	console.log(`LORE_STAGE_OK ${receipt.assets.length} mode=${receipt.mode}`);
	return receipt;
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	stage().catch(() => {
		console.error(
			"LORE_STAGE_FAILED; no references or public evidence promoted",
		);
		process.exitCode = 1;
	});
}
