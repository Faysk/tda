import { authorizeLembraRead } from "@/features/lembra/access";
import {
	isLembraMediaMime,
	isLembraUuid,
	type LembraMediaMime,
} from "@/features/lembra/model";
import {
	loadLembraReferenceRow,
	resolveLembraCampaignId,
	validLembraReferenceRow,
} from "@/features/lembra/repository";
import {
	lembraPersistenceEnabled,
	readVerifiedLembraObject,
} from "@/features/lembra/server";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import { editDataClient } from "@/integrations/supabase/server";

export const dynamic = "force-dynamic";

function accessStatus(reason: string) {
	if (reason === "unauthenticated") return 401;
	if (reason === "forbidden" || reason === "profile_unresolved") return 403;
	return 503;
}

export async function GET(
	_request: Request,
	context: { params: Promise<{ referenceId: string }> },
) {
	if (!lembraPersistenceEnabled()) {
		return new Response("Lembra media unavailable", { status: 503 });
	}

	const { referenceId } = await context.params;
	if (!isLembraUuid(referenceId)) return new Response("Not found", { status: 404 });

	const authorization = await authorizeLembraRead();
	if (!authorization.ok) {
		return new Response("Access denied", { status: accessStatus(authorization.reason) });
	}

	const client = editDataClient();
	if (!client) return new Response("Dependency unavailable", { status: 503 });

	try {
		const campaignId = await resolveLembraCampaignId(client);
		if (!campaignId) return new Response("Not found", { status: 404 });

		const row = await loadLembraReferenceRow(client, campaignId, referenceId);
		if (!row || !validLembraReferenceRow(row) || !isLembraMediaMime(row.mime_type)) {
			return new Response("Not found", { status: 404 });
		}

		const byteSize = Number(row.byte_size);
		const bytes = await readVerifiedLembraObject({
			campaignSlug: CAMPAIGN_SLUG,
			referenceId: row.id,
			bucket: row.staged_bucket,
			objectKey: row.object_key,
			sha256: row.sha256,
			mimeType: row.mime_type as LembraMediaMime,
			bytes: byteSize,
			width: row.width,
			height: row.height,
		});

		return new Response(Buffer.from(bytes), {
			status: 200,
			headers: {
				"Content-Type": row.mime_type,
				"Content-Length": String(bytes.length),
				"Cache-Control": "private, no-store",
				"X-Content-Type-Options": "nosniff",
			},
		});
	} catch (error) {
		console.error(
			"Lembra image read failed",
			error instanceof Error ? error.message : "unknown_error",
		);
		return new Response("Reference unavailable", { status: 503 });
	}
}
