import "server-only";

import { sessionComicFeatureEnabled } from "@/features/edit/sessions/session-comic-feature";
import {
	readPublishedSessionComicPages,
	type SessionComicPublishedPage,
} from "@/features/edit/sessions/session-comic-model";
import { publishedDataClient } from "@/integrations/supabase/server";
import type { PublishedSession } from "./model";

/**
 * The public HQ projection must originate from the active immutable
 * publication pointer, never from a private draft or arbitrary media_assets.
 * The caller already selected a published, visible session.
 */
export async function findPublishedSessionComic(
	session: PublishedSession,
): Promise<readonly SessionComicPublishedPage[]> {
	if (!sessionComicFeatureEnabled()) return [];
	const client = publishedDataClient();
	if (!client) throw new Error("Public HQ data source unavailable");
	const { data: raw, error } = await client
		.from("sessions")
		.select(
			"id,campaign_id,current_session_publication_id,campaigns!inner(id,slug,public_slug,lifecycle,visibility)",
		)
		.eq("campaign_id", session.campaignId)
		.eq("source_session_id", session.id)
		.eq("status", "published")
		.eq("campaigns.slug", session.campaignTechnicalSlug)
		.eq("campaigns.public_slug", session.campaignSlug)
		.eq("campaigns.lifecycle", "active")
		.eq("campaigns.visibility", "public")
		.maybeSingle();

	if (error) throw new Error("Public HQ session lookup unavailable");
	if (!raw) return [];
	const row = raw as Record<string, unknown>;
	const publicationId = row.current_session_publication_id;
	const sessionId = row.id;
	if (typeof publicationId !== "string" || typeof sessionId !== "string")
		return [];

	// Prefer the latest independent HQ snapshot. It is immutable and never
	// rewrites the editorial publication; retain legacy snapshots as fallback.
	const { data: independent, error: independentError } = await client
		.from("session_comic_publications")
		.select("pages")
		.eq("session_id", sessionId)
		.eq("campaign_id", session.campaignId)
		.order("version", { ascending: false })
		.limit(1)
		.maybeSingle();
	if (independentError) throw new Error("Independent public HQ lookup unavailable");
	if (independent) {
		return readPublishedSessionComicPages(
			independent.pages, session.campaignTechnicalSlug, sessionId,
		) ?? [];
	}

	const { data, error: publicationError } = await client
		.from("session_publications")
		.select("id,session_id,campaign_id,comic_pages")
		.eq("id", publicationId)
		.eq("session_id", sessionId)
		.eq("campaign_id", session.campaignId)
		.maybeSingle();
	if (publicationError || !data)
		throw new Error("Public HQ publication read unavailable");

	// Invalid or foreign images are omitted entirely, never rendered in part.
	return readPublishedSessionComicPages(
		data.comic_pages,
		session.campaignTechnicalSlug,
		sessionId,
	) ?? [];
}
