import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { inspectImage } from "../migrate-session-media-r2.mjs";
import { inspectRemote, publishAll } from "./pipeline.mjs";

/** Operational preparation, not an automatic change to the public registry. */
export async function publishCampaignCover({ bytes, campaignId, technicalSlug, workspace, privateClient, publicClient, verifyDelivery }) {
	if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(campaignId) ||
		!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(technicalSlug) || technicalSlug.length > 80)
		throw new Error("Invalid stable campaign identity");
	const image = await inspectImage(bytes); // Full decode, no resampling or lossy conversion.
	const file = `cover.${image.extension}`;
	const masterKey = `campaigns/${technicalSlug}/masters/${image.sha256}/${file}`;
	const master = { objectKey: masterKey, bytes: image.bytes, sha256: image.sha256, contentType: image.mime };
	const privateManifest = { bucket: "tda-media-private" };
	const exists = await inspectRemote(privateClient, privateManifest, master);
	if (!exists.exists) {
		await privateClient.send(new PutObjectCommand({
			Bucket: privateManifest.bucket, Key: masterKey, Body: bytes,
			ContentType: image.mime, CacheControl: "private, no-store", IfNoneMatch: "*",
		}));
	}
	if (!(await inspectRemote(privateClient, privateManifest, master)).exists)
		throw new Error("Campaign cover master read-back failed");

	await mkdir(join(workspace, "media/sources/cover"), { recursive: true });
	await mkdir(join(workspace, "media/manifests"), { recursive: true });
	await writeFile(join(workspace, "media/sources/cover", file), bytes);
	const manifest = {
		schemaVersion: 1, project: `campaign-${campaignId}`, namespace: `campaigns/${technicalSlug}/cover`,
		bucket: "tda-media-public", publicOrigin: "https://media.dnd.faysk.dev",
		assets: [{ file, source: `media/sources/cover/${file}`, bytes: image.bytes, sha256: image.sha256, contentType: image.mime }],
	};
	await writeFile(join(workspace, "media/manifests/cover.json"), JSON.stringify(manifest));
	const receipt = await publishAll({ repoRoot: workspace, remoteClient: publicClient, verifyDelivery });
	const asset = receipt.assets[0];
	if (!asset?.readBackVerified || !asset.publicDeliveryVerified || receipt.assets.length !== 1)
		throw new Error("Campaign cover public delivery is not verified");
	return {
		campaignId, technicalSlug,
		cover: {
			state: "verified-public", publicUrl: asset.publicUrl, objectKey: asset.objectKey,
			bucket: receipt.bucket, sha256: image.sha256, mimeType: image.mime, bytes: image.bytes,
			width: image.width, height: image.height, verifiedAt: receipt.createdAt,
			readBackVerified: true, publicDeliveryVerified: true,
		},
		master: { bucket: privateManifest.bucket, objectKey: masterKey, sha256: image.sha256, readBackVerified: true },
	};
}

function client(privateBucket) {
	const account = process.env.R2_ACCOUNT_ID;
	const accessKeyId = process.env[privateBucket ? "R2_PRIVATE_ACCESS_KEY_ID" : "R2_ACCESS_KEY_ID"];
	const secretAccessKey = process.env[privateBucket ? "R2_PRIVATE_SECRET_ACCESS_KEY" : "R2_SECRET_ACCESS_KEY"];
	if (!account || !accessKeyId || !secretAccessKey) throw new Error("Authorized R2 credentials are missing");
	return new S3Client({ region: "auto", endpoint: `https://${account}.r2.cloudflarestorage.com`, credentials: { accessKeyId, secretAccessKey }, requestChecksumCalculation: "WHEN_REQUIRED" });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	const { values } = parseArgs({ options: {
		publish: { type: "boolean" }, source: { type: "string" }, workspace: { type: "string" },
		"campaign-id": { type: "string" }, "technical-slug": { type: "string" },
	} });
	if (!values.publish || !values.source || !values.workspace) throw new Error("Explicit --publish, --source and isolated --workspace are required");
	const workspace = resolve(values.workspace);
	const binding = await publishCampaignCover({ bytes: await readFile(values.source), campaignId: values["campaign-id"], technicalSlug: values["technical-slug"], workspace, privateClient: client(true), publicClient: client(false) });
	await writeFile(join(workspace, "campaign-cover-candidate.json"), JSON.stringify(binding, null, 2) + "\n");
	console.log("CAMPAIGN_COVER_CANDIDATE_VERIFIED: review the binding and consumer before promotion");
}
