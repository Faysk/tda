import { findPublishedSession, PublishedSessionUnavailableError } from "@/features/sessions/repository";

export const runtime = "nodejs";

type Context = { params: Promise<{ campaign: string; sessionId: string }> };
const noStore = { "Cache-Control": "no-store" };

export async function GET(_request: Request, context: Context) {
	const { campaign, sessionId } = await context.params;
	if (
		!/^[a-z0-9-]{1,220}$/.test(campaign) ||
		!sessionId ||
		sessionId.length > 220
	) {
		return Response.json({ error: "not_found" }, { status: 404, headers: noStore });
	}
	try {
		const session = await findPublishedSession(campaign, sessionId);
		if (!session) {
			return Response.json({ error: "not_found" }, { status: 404, headers: noStore });
		}
		return Response.json({
			id: session.id,
			campaign: { slug: session.campaignSlug, name: session.campaignName },
			title: session.title,
			date: session.date,
			arc: session.arc,
			summaryShort: session.summary,
			summaryFull: session.fullSummary ?? "",
			format: "markdown",
			coverImage: session.coverImage ?? null,
			heroImage: session.heroImage ?? null,
			url: `/campanhas/${encodeURIComponent(session.campaignSlug)}/sessoes/${encodeURIComponent(session.id)}`,
		}, { headers: { "Cache-Control": "public, max-age=0, s-maxage=60" } });
	} catch (error) {
		if (!(error instanceof PublishedSessionUnavailableError)) {
			console.error("Public session API detail failed", { errorType: "unexpected" });
		}
		return Response.json({ error: "service_unavailable" }, { status: 503, headers: noStore });
	}
}
