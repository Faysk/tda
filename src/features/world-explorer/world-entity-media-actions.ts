"use server";

import { randomUUID } from "node:crypto";
import { authorizeCampaignCapabilityServer } from "@/features/auth/server";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import { editDataClient } from "@/integrations/supabase/server";
import {
	isWorldEntityMediaAssetId,
	worldEntityMediaPreviewUrl,
} from "./world-entity-media";
import {
	uploadWorldEntityPortrait,
	worldEntityMediaEnabled,
} from "./world-entity-media-server";

const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type WorldEntityPortraitUploadResult =
	| Readonly<{
			ok: true;
			assetId: string;
			previewUrl: string;
			width: number;
			height: number;
			mimeType: "image/png" | "image/webp";
	  }>
	| Readonly<{
			ok: false;
			reason:
				| "disabled"
				| "unauthenticated"
				| "profile_unresolved"
				| "forbidden"
				| "invalid_payload"
				| "lease_lost"
				| "dependency_unavailable";
	  }>;

async function contentEditor() {
	return authorizeCampaignCapabilityServer({
		action: EDIT_CAPABILITIES.contentEdit,
		campaignSlug: CAMPAIGN_SLUG,
	});
}

export async function worldEntityMediaFeatureEnabledAction(): Promise<boolean> {
	if (!worldEntityMediaEnabled()) return false;
	const access = await contentEditor();
	return access.ok;
}

function uploadFailure(error: unknown): WorldEntityPortraitUploadResult {
	if (error instanceof Error) {
		console.error("World entity portrait upload failed", error.message);
	}
	return { ok: false, reason: "dependency_unavailable" };
}

export async function uploadWorldEntityPortraitAction(
	leaseToken: string,
	entityId: string,
	formData: FormData,
): Promise<WorldEntityPortraitUploadResult> {
	if (!worldEntityMediaEnabled()) return { ok: false, reason: "disabled" };
	if (!UUID_PATTERN.test(leaseToken) || !UUID_PATTERN.test(entityId)) {
		return { ok: false, reason: "invalid_payload" };
	}
	const access = await contentEditor();
	if (!access.ok) return { ok: false, reason: access.reason };
	const client = editDataClient();
	if (!client) return { ok: false, reason: "dependency_unavailable" };

	const { data: campaign, error: campaignError } = await client
		.from("campaigns")
		.select("id")
		.eq("slug", CAMPAIGN_SLUG)
		.maybeSingle();
	if (campaignError || !campaign?.id) return uploadFailure(campaignError);

	const { data: lease, error: leaseError } = await client
		.from("world_edit_leases")
		.select("holder_profile_id,lease_token,expires_at")
		.eq("campaign_id", campaign.id)
		.maybeSingle();
	if (leaseError) return uploadFailure(leaseError);
	if (
		!lease ||
		lease.holder_profile_id !== access.profileId ||
		lease.lease_token !== leaseToken ||
		Date.parse(lease.expires_at) <= Date.now()
	) {
		return { ok: false, reason: "lease_lost" };
	}

	const portrait = formData.get("portrait");
	if (!(portrait instanceof File) || portrait.size < 1) {
		return { ok: false, reason: "invalid_payload" };
	}

	try {
		const bytes = new Uint8Array(await portrait.arrayBuffer());
		const uploaded = await uploadWorldEntityPortrait({ entityId, bytes });

		const { data: existing, error: existingError } = await client
			.from("media_assets")
			.select("id,sha256,mime_type,byte_size,width,height,read_back_verified")
			.eq("campaign_id", campaign.id)
			.eq("staged_bucket", uploaded.bucket)
			.eq("object_key", uploaded.objectKey)
			.maybeSingle();
		if (existingError) return uploadFailure(existingError);

		let assetId: string;
		if (existing?.id) {
			if (
				existing.sha256 !== uploaded.sha256 ||
				existing.mime_type !== uploaded.mimeType ||
				Number(existing.byte_size) !== uploaded.bytes ||
				existing.width !== uploaded.width ||
				existing.height !== uploaded.height ||
				existing.read_back_verified !== true
			) {
				return { ok: false, reason: "dependency_unavailable" };
			}
			assetId = existing.id;
		} else {
			assetId = randomUUID();
			const { error: insertError } = await client.from("media_assets").insert({
				id: assetId,
				campaign_id: campaign.id,
				media_kind: "image",
				role_hint: "portrait",
				status: "staged",
				staged_bucket: uploaded.bucket,
				object_key: uploaded.objectKey,
				sha256: uploaded.sha256,
				mime_type: uploaded.mimeType,
				byte_size: uploaded.bytes,
				width: uploaded.width,
				height: uploaded.height,
				read_back_verified: true,
				created_by: access.profileId,
			});
			if (insertError) return uploadFailure(insertError);
		}

		if (!isWorldEntityMediaAssetId(assetId)) {
			return { ok: false, reason: "dependency_unavailable" };
		}
		const previewUrl = worldEntityMediaPreviewUrl(assetId);
		if (!previewUrl) return { ok: false, reason: "dependency_unavailable" };
		return {
			ok: true,
			assetId,
			previewUrl,
			width: uploaded.width,
			height: uploaded.height,
			mimeType: uploaded.mimeType,
		};
	} catch (error) {
		if (error instanceof Error && /INVALID_|UNSUPPORTED_IMAGE/u.test(error.message)) {
			return { ok: false, reason: "invalid_payload" };
		}
		return uploadFailure(error);
	}
}
