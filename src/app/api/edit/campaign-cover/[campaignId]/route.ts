import { revalidatePath } from "next/cache";
import { WORLD_ENTITY_MEDIA_MAX_BYTES } from "@/features/world-explorer/world-entity-media";
import { authorizeCampaignCoverTarget } from "@/features/campaigns/campaign-cover-access";
import {
	removeCampaignCoverBinding,
	saveCampaignCover,
} from "@/features/campaigns/campaign-cover-service";

export const dynamic = "force-dynamic";

function responseForAccess(reason: string): Response {
	if (reason === "unauthenticated")
		return Response.json({ ok: false, reason }, { status: 401 });
	if (reason === "not_found")
		return Response.json({ ok: false, reason }, { status: 404 });
	if (reason === "dependency_unavailable")
		return Response.json({ ok: false, reason }, { status: 503 });
	return Response.json({ ok: false, reason }, { status: 403 });
}

function sameOrigin(request: Request): boolean {
	const origin = request.headers.get("origin");
	return !origin || origin === new URL(request.url).origin;
}

function invalidateCampaignCover(publicSlug: string) {
	revalidatePath("/campanhas");
	revalidatePath(
		"/campanhas/" + encodeURIComponent(publicSlug) + "/sessoes",
	);
	revalidatePath("/edit/campanhas");
}

export async function PUT(
	request: Request,
	{ params }: { params: Promise<{ campaignId: string }> },
) {
	if (!sameOrigin(request))
		return Response.json(
			{ ok: false, reason: "forbidden" },
			{ status: 403 },
		);

	const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
	if (contentType !== "image/png" && contentType !== "image/webp") {
		return Response.json(
			{ ok: false, reason: "unsupported_media_type" },
			{ status: 415 },
		);
	}
	const declaredLengthHeader = request.headers.get("content-length");
	if (declaredLengthHeader !== null) {
		const declaredLength = Number(declaredLengthHeader);
		if (
			!Number.isSafeInteger(declaredLength) ||
			declaredLength < 24 ||
			declaredLength > WORLD_ENTITY_MEDIA_MAX_BYTES
		) {
			return Response.json(
				{ ok: false, reason: "invalid_size" },
				{ status: 413 },
			);
		}
	}

	const { campaignId } = await params;
	const access = await authorizeCampaignCoverTarget(campaignId);
	if (!access.ok) return responseForAccess(access.reason);

	try {
		const bytes = new Uint8Array(await request.arrayBuffer());
		if (bytes.length < 24 || bytes.length > WORLD_ENTITY_MEDIA_MAX_BYTES) {
			return Response.json(
				{ ok: false, reason: "invalid_size" },
				{ status: 413 },
			);
		}
		const result = await saveCampaignCover({
			target: access.target,
			bytes,
			expectedMimeType: contentType,
		});
		invalidateCampaignCover(access.target.campaignPublicSlug);
		return Response.json(
			{ ok: true, ...result },
			{
				status: 200,
				headers: { "Cache-Control": "private, no-store" },
			},
		);
	} catch (error) {
		console.error(
			"Campaign cover upload failed",
			error instanceof Error ? error.message : "unknown_error",
		);
		return Response.json(
			{ ok: false, reason: "dependency_unavailable" },
			{ status: 503 },
		);
	}
}

export async function DELETE(
	request: Request,
	{ params }: { params: Promise<{ campaignId: string }> },
) {
	if (!sameOrigin(request))
		return Response.json(
			{ ok: false, reason: "forbidden" },
			{ status: 403 },
		);

	const { campaignId } = await params;
	const access = await authorizeCampaignCoverTarget(campaignId);
	if (!access.ok) return responseForAccess(access.reason);

	try {
		await removeCampaignCoverBinding(access.target);
		invalidateCampaignCover(access.target.campaignPublicSlug);
		return new Response(null, {
			status: 204,
			headers: { "Cache-Control": "private, no-store" },
		});
	} catch (error) {
		console.error(
			"Campaign cover removal failed",
			error instanceof Error ? error.message : "unknown_error",
		);
		return Response.json(
			{ ok: false, reason: "dependency_unavailable" },
			{ status: 503 },
		);
	}
}
