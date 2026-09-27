import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import { authorizeCampaignCapabilityServer } from "@/features/auth/server";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import { findUnsafeEditSessionBySourceId } from "@/features/edit/sessions/repository";
import {
	buildTranscriptDownload,
	transcriptDownloadFailureStatus,
} from "@/features/edit/transcript/download";
import { readTranscriptSnapshot } from "@/features/edit/transcript/repository";
import { isUnsafeEditEnabled } from "@/features/edit/unsafe-access";

type RouteContext = Readonly<{
	params: Promise<{ campaignSlug: string; id: string }>;
}>;

function failure(status: number): Response {
	return Response.json(
		{ ok: false, reason: status === 401 ? "unauthenticated" : "not_found" },
		{
			status,
			headers: {
				"Cache-Control": "private, no-store",
				"X-Content-Type-Options": "nosniff",
			},
		},
	);
}

export async function GET(_request: Request, { params }: RouteContext) {
	const { campaignSlug, id } = await params;
	if (
		campaignSlug !== CAMPAIGN_SLUG ||
		!id ||
		id.length > 220 ||
		!isUnsafeEditEnabled()
	)
		return failure(404);

	const access = await authorizeCampaignCapabilityServer({
		action: EDIT_CAPABILITIES.transcriptRead,
		campaignSlug,
	});
	if (!access.ok)
		return failure(transcriptDownloadFailureStatus(access.reason));

	try {
		const session = await findUnsafeEditSessionBySourceId(id);
		if (!session) return failure(404);
		const snapshot = await readTranscriptSnapshot({
			campaignSlug,
			sessionId: session.id,
		});
		if (!snapshot) return failure(503);

		const download = buildTranscriptDownload({
			title: session.title,
			sessionDate: session.sessionDate,
			arc: session.arc,
			sourceSessionId: session.sourceSessionId,
			snapshot,
		});
		return new Response(download.body, {
			status: 200,
			headers: download.headers,
		});
	} catch {
		return failure(503);
	}
}
