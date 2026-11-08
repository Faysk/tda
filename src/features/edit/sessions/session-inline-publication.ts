import "server-only";

import { parseStoryMarkdown } from "@/features/sessions/story-markdown";
import { editDataClient } from "@/integrations/supabase/server";
import {
	WORLD_ENTITY_MEDIA_PUBLIC_BUCKET,
	WORLD_ENTITY_MEDIA_PUBLIC_ORIGIN,
} from "@/features/world-explorer/world-entity-media";
import { promoteSessionInline } from "./session-inline-media-server";
import {
	isSessionInlineMime,
	isSessionInlineSha256,
	sessionInlineObjectKey,
} from "./session-inline-media";

type Asset = {
	id: string;
	status: string;
	role_hint: string;
	staged_bucket: string;
	object_key: string;
	sha256: string;
	mime_type: string;
	byte_size: number | string;
	width: number;
	height: number;
	read_back_verified: boolean;
	public_bucket: string | null;
	public_object_key: string | null;
	public_delivery_verified: boolean | null;
	public_verified_at: string | null;
};

function size(value: unknown): number | null {
	const n = Number(value);
	return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function alreadyPublic(asset: Asset, key: string): boolean {
	return (
		asset.status === "verified_public" &&
		asset.role_hint === "session_inline_image" &&
		asset.object_key === key &&
		asset.public_object_key === key &&
		asset.public_bucket === WORLD_ENTITY_MEDIA_PUBLIC_BUCKET &&
		asset.read_back_verified === true &&
		asset.public_delivery_verified === true &&
		Boolean(asset.public_verified_at)
	);
}

/** Invoked only after the usual session publication capability check.
 * Verifies and promotes each referenced inline asset before the publication
 * RPC reads the unchanged Markdown draft. This never publishes unused uploads.
 */
export async function prepareSessionInlineForPublication(input: {
	sessionId: string;
	campaignId: string;
	campaignSlug: string;
	summary: string;
}): Promise<boolean> {
	const images = parseStoryMarkdown(input.summary).filter(
		(block) => block.type === "image",
	);
	const prefix = WORLD_ENTITY_MEDIA_PUBLIC_ORIGIN + "/campaigns/";
	const ownPrefix = prefix + input.campaignSlug + "/sessions/" + input.sessionId.toLowerCase() + "/inline/";
	const urls = [...new Set(images.map((image) => image.src).filter((url) =>
		url.startsWith(prefix) && url.includes("/inline/")
	))];
	if (urls.length > 32) return false;
	if (urls.length === 0) return true;
	const client = editDataClient();
	if (!client) throw new Error("Inline image publication connection unavailable");

	for (const url of urls) {
		if (!url.startsWith(ownPrefix)) return false;
		const rest = url.slice(ownPrefix.length);
		const match = /^([a-f0-9]{64})\.(png|webp)$/u.exec(rest);
		if (!match) return false;
		const key = sessionInlineObjectKey({
			campaignSlug: input.campaignSlug,
			sessionId: input.sessionId,
			sha256: match[1],
			extension: match[2] as "png" | "webp",
		});
		if (!key) return false;
		const load = async () => {
			const { data, error } = await client.from("media_assets")
				.select("id,status,role_hint,staged_bucket,object_key,sha256,mime_type,byte_size,width,height,read_back_verified,public_bucket,public_object_key,public_delivery_verified,public_verified_at")
				.eq("campaign_id", input.campaignId)
				.eq("role_hint", "session_inline_image")
				.eq("object_key", key)
				.maybeSingle();
			if (error) throw new Error("Inline image lookup unavailable");
			return data as Asset | null;
		};
		let asset = await load();
		if (!asset || asset.role_hint !== "session_inline_image" ||
			asset.object_key !== key || asset.sha256 !== match[1] ||
			!isSessionInlineSha256(asset.sha256) ||
			!isSessionInlineMime(asset.mime_type) ||
			asset.read_back_verified !== true) return false;
		const extension = asset.mime_type === "image/png" ? "png" : "webp";
		if (extension !== match[2]) return false;
		if (alreadyPublic(asset, key)) continue;
		const bytes = size(asset.byte_size);
		const width = size(asset.width);
		const height = size(asset.height);
		if (asset.status !== "staged" || !bytes || !width || !height ||
			width * height > 64_000_000 || !asset.staged_bucket) return false;
		const promoted = await promoteSessionInline({
			campaignSlug: input.campaignSlug,
			sessionId: input.sessionId,
			stagedBucket: asset.staged_bucket,
			objectKey: key,
			sha256: asset.sha256,
			mimeType: asset.mime_type,
			bytes,
			width,
			height,
		});
		const { error } = await client.from("media_assets").update({
			status: "verified_public",
			public_bucket: promoted.publicBucket,
			public_object_key: promoted.publicObjectKey,
			public_delivery_verified: true,
			public_verified_at: promoted.verifiedAt,
			updated_at: promoted.verifiedAt,
		}).eq("campaign_id", input.campaignId)
			.eq("id", asset.id).eq("role_hint", "session_inline_image").eq("status", "staged");
		if (error) throw new Error("Inline image promotion state unavailable");
		asset = await load();
		if (!asset || !alreadyPublic(asset, key)) return false;
	}
	return true;
}
