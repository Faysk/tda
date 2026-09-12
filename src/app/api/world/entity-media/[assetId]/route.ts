import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { authorizeCampaignCapabilityServer } from "@/features/auth/server";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import {
	isWorldEntityMediaAssetId,
	WORLD_ENTITY_MEDIA_PUBLIC_BUCKET,
} from "@/features/world-explorer/world-entity-media";
import {
	readWorldEntityMediaObject,
	worldEntityMediaEnabled,
} from "@/features/world-explorer/world-entity-media-server";
import { editDataClient } from "@/integrations/supabase/server";

const ENTITY_PORTRAIT_KEY =
	/^campaigns\/yuhara-main\/entities\/[0-9a-f-]{36}\/portrait\/[a-f0-9]{64}\.(png|webp)$/u;

function notFound() {
	return new NextResponse(null, { status: 404 });
}

export async function GET(
	_request: Request,
	context: { params: Promise<{ assetId: string }> },
) {
	if (!worldEntityMediaEnabled()) return notFound();
	const { assetId } = await context.params;
	if (!isWorldEntityMediaAssetId(assetId)) return notFound();

	const access = await authorizeCampaignCapabilityServer({
		action: EDIT_CAPABILITIES.contentEdit,
		campaignSlug: CAMPAIGN_SLUG,
	});
	if (!access.ok) return notFound();
	const client = editDataClient();
	if (!client) return new NextResponse(null, { status: 503 });

	const { data: campaign, error: campaignError } = await client
		.from("campaigns")
		.select("id")
		.eq("slug", CAMPAIGN_SLUG)
		.maybeSingle();
	if (campaignError || !campaign?.id) return new NextResponse(null, { status: 503 });

	const { data: asset, error } = await client
		.from("media_assets")
		.select(
			"id,campaign_id,status,staged_bucket,object_key,sha256,mime_type,byte_size,read_back_verified,public_bucket,public_object_key",
		)
		.eq("id", assetId)
		.eq("campaign_id", campaign.id)
		.maybeSingle();
	if (error) return new NextResponse(null, { status: 503 });
	if (!asset || asset.read_back_verified !== true) return notFound();

	const publicReady =
		asset.status === "verified_public" &&
		asset.public_bucket === WORLD_ENTITY_MEDIA_PUBLIC_BUCKET &&
		asset.public_object_key === asset.object_key;
	const bucket = publicReady ? asset.public_bucket : asset.staged_bucket;
	const objectKey = publicReady ? asset.public_object_key : asset.object_key;
	if (!bucket || !objectKey || !ENTITY_PORTRAIT_KEY.test(objectKey)) return notFound();
	if (asset.mime_type !== "image/png" && asset.mime_type !== "image/webp") return notFound();

	try {
		const bytes = await readWorldEntityMediaObject({ bucket, objectKey });
		const hash = createHash("sha256").update(bytes).digest("hex");
		if (hash !== asset.sha256 || bytes.length !== Number(asset.byte_size)) {
			return new NextResponse(null, { status: 502 });
		}
		return new NextResponse(Buffer.from(bytes), {
			status: 200,
			headers: {
				"Content-Type": asset.mime_type,
				"Content-Length": String(bytes.length),
				"Cache-Control": "private, no-store, max-age=0",
				"X-Content-Type-Options": "nosniff",
			},
		});
	} catch (readError) {
		if (readError instanceof Error) {
			console.error("World entity media preview failed", readError.message);
		}
		return new NextResponse(null, { status: 502 });
	}
}
