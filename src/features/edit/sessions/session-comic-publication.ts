import "server-only";

import {
	WORLD_ENTITY_MEDIA_PUBLIC_BUCKET,
	WORLD_ENTITY_MEDIA_PUBLIC_ORIGIN,
} from "@/features/world-explorer/world-entity-media";
import { editDataClient } from "@/integrations/supabase/server";
import { promoteSessionComic } from "./session-comic-media-server";
import {
	isSessionComicMime,
	isSessionComicSha256,
	sessionComicObjectKey,
} from "./session-comic-media";
import {
	type SessionComicDraftPage,
	type SessionComicPublishedPage,
	validateSessionComicDraftPages,
} from "./session-comic-model";

type AssetRow = Readonly<{
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
}>;

function safeSize(value: unknown): number | null {
	const number = Number(value);
	return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function publicUrl(
	asset: AssetRow,
	sessionId: string,
	campaignSlug: string,
): string | null {
	if (
		asset.role_hint !== "session_comic_page" ||
		asset.status !== "verified_public" ||
		asset.read_back_verified !== true ||
		asset.public_delivery_verified !== true ||
		asset.public_bucket !== WORLD_ENTITY_MEDIA_PUBLIC_BUCKET ||
		!asset.public_verified_at ||
		!isSessionComicSha256(asset.sha256) ||
		!isSessionComicMime(asset.mime_type)
	) return null;
	const extension = asset.mime_type === "image/png" ? "png" : "webp";
	const key = sessionComicObjectKey({
		campaignSlug,
		sessionId,
		sha256: asset.sha256,
		extension,
	});
	return key && asset.object_key === key && asset.public_object_key === key
		? WORLD_ENTITY_MEDIA_PUBLIC_ORIGIN + "/" + key
		: null;
}

/**
 * Only a campaign publication-authorized caller may invoke this helper.
 * Prepared URLs are not exposed until the DB's immutable publication CAS
 * transaction binds the entire ordered sequence to the active snapshot.
 */
export async function prepareSessionComicForPublication(input: {
	sessionId: string;
	campaignId: string;
	campaignSlug: string;
	pages: readonly SessionComicDraftPage[];
}): Promise<readonly SessionComicPublishedPage[] | null> {
	if (validateSessionComicDraftPages(input.pages, { forPublication: true }).length)
		return null;

	const client = editDataClient();
	if (!client) throw new Error("Session comic media connection unavailable");

	const result: SessionComicPublishedPage[] = [];
	for (const page of input.pages) {
		const lookup = async (): Promise<AssetRow | null> => {
			const { data, error } = await client
				.from("media_assets")
				.select(
					"id,status,role_hint,staged_bucket,object_key,sha256,mime_type,byte_size,width,height,read_back_verified,public_bucket,public_object_key,public_delivery_verified,public_verified_at",
				)
				.eq("id", page.assetId)
				.eq("campaign_id", input.campaignId)
				.maybeSingle();
			if (error) throw new Error("Session comic media lookup unavailable");
			return data as AssetRow | null;
		};

		let asset = await lookup();
		if (
			!asset ||
			asset.role_hint !== "session_comic_page" ||
			!isSessionComicSha256(asset.sha256) ||
			!isSessionComicMime(asset.mime_type) ||
			asset.read_back_verified !== true
		) return null;

		let url = publicUrl(asset, input.sessionId, input.campaignSlug);
		if (!url) {
			const bytes = safeSize(asset.byte_size);
			const width = safeSize(asset.width);
			const height = safeSize(asset.height);
			const key = sessionComicObjectKey({
				campaignSlug: input.campaignSlug,
				sessionId: input.sessionId,
				sha256: asset.sha256,
				extension: asset.mime_type === "image/png" ? "png" : "webp",
			});
			if (
				asset.status !== "staged" ||
				!bytes || !width || !height ||
				!asset.staged_bucket ||
				!key || asset.object_key !== key
			) return null;
			const promoted = await promoteSessionComic({
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
			const { data: saved, error: saveError } = await client
				.from("media_assets")
				.update({
					status: "verified_public",
					public_bucket: promoted.publicBucket,
					public_object_key: promoted.publicObjectKey,
					public_delivery_verified: true,
					public_verified_at: promoted.verifiedAt,
					updated_at: promoted.verifiedAt,
				})
				.eq("id", page.assetId)
				.eq("campaign_id", input.campaignId)
				.eq("role_hint", "session_comic_page")
				.eq("status", "staged")
				.select(
					"id,status,role_hint,staged_bucket,object_key,sha256,mime_type,byte_size,width,height,read_back_verified,public_bucket,public_object_key,public_delivery_verified,public_verified_at",
				)
				.maybeSingle();
			if (saveError) throw new Error("Session comic media promotion unavailable");
			asset = (saved as AssetRow | null) ?? (await lookup());
			if (!asset) return null;
			url = publicUrl(asset, input.sessionId, input.campaignSlug);
		}
		if (!url) return null;
		const width = safeSize(asset.width);
		const height = safeSize(asset.height);
		if (!width || !height || width * height > 64_000_000) return null;
		result.push({
			imageUrl: url,
			altText: page.altText,
			caption: page.caption,
			width,
			height,
		});
	}
	return result;
}
