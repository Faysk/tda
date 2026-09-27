import { authorizeCampaignCapabilityServer } from "@/features/auth/server";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import {
	readPreparedSessionTranscript,
	transcriptFilename,
	transcriptMarkdown,
} from "@/features/edit/sessions/transcript-revision";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";

export const runtime = "nodejs";

type RouteContext = Readonly<{
	params: Promise<{ id: string }>;
}>;

export async function GET(_request: Request, { params }: RouteContext) {
	const access = await authorizeCampaignCapabilityServer({
		action: EDIT_CAPABILITIES.transcriptRead,
		campaignSlug: CAMPAIGN_SLUG,
	});
	if (!access.ok) {
		const status =
			access.reason === "unauthenticated"
				? 401
				: access.reason === "dependency_unavailable"
					? 503
					: 404;
		return Response.json({ ok: false }, { status });
	}

	const { id } = await params;
	let snapshot: Awaited<ReturnType<typeof readPreparedSessionTranscript>>;
	try {
		snapshot = await readPreparedSessionTranscript(String(id || ""));
	} catch {
		return Response.json({ ok: false }, { status: 503 });
	}
	if (!snapshot) return Response.json({ ok: false }, { status: 404 });

	const filename = transcriptFilename(snapshot);
	return new Response(transcriptMarkdown(snapshot), {
		status: 200,
		headers: {
			"Cache-Control": "private, no-store",
			"Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
			"Content-Type": "text/markdown; charset=utf-8",
			"X-Content-Type-Options": "nosniff",
		},
	});
}
