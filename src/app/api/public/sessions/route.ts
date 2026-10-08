import { listPublishedSessions, PublishedSessionUnavailableError } from "@/features/sessions/repository";

export const runtime = "nodejs";

const headers = { "Cache-Control": "public, max-age=0, s-maxage=60" };
const noStore = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
	const url = new URL(request.url);
	const campaign = url.searchParams.get("campaign");
	const limitRaw = url.searchParams.get("limit");
	const offsetRaw = url.searchParams.get("offset");
	if (
		(campaign !== null && (!/^[a-z0-9-]{1,220}$/.test(campaign))) ||
		(limitRaw !== null && !/^[1-9]\d{0,2}$/.test(limitRaw)) ||
		(offsetRaw !== null && !/^(0|[1-9]\d{0,5})$/.test(offsetRaw))
	) {
		return Response.json({ error: "invalid_query" }, { status: 400, headers: noStore });
	}
	const limit = limitRaw === null ? 50 : Number(limitRaw);
	const offset = offsetRaw === null ? 0 : Number(offsetRaw);
	if (limit > 100) {
		return Response.json({ error: "invalid_query" }, { status: 400, headers: noStore });
	}
	try {
		const sessions = await listPublishedSessions(campaign ?? undefined);
		if (sessions === null) {
			return Response.json({ error: "service_unavailable" }, { status: 503, headers: noStore });
		}
		return Response.json({
			data: sessions.slice(offset, offset + limit).map((session) => ({
				id: session.id,
				campaign: { slug: session.campaignSlug, name: session.campaignName },
				title: session.title,
				date: session.date,
				arc: session.arc,
				summaryShort: session.summary,
				coverImage: session.coverImage ?? null,
				heroImage: session.heroImage ?? null,
				url: `/campanhas/${encodeURIComponent(session.campaignSlug)}/sessoes/${encodeURIComponent(session.id)}`,
			})),
			pagination: { offset, limit, total: sessions.length, hasMore: offset + limit < sessions.length },
		}, { headers });
	} catch (error) {
		if (!(error instanceof PublishedSessionUnavailableError)) {
			console.error("Public session API list failed", { errorType: "unexpected" });
		}
		return Response.json({ error: "service_unavailable" }, { status: 503, headers: noStore });
	}
}
