import "server-only";
import { cache } from "react";
import { publishedDataClient } from "@/integrations/supabase/server";
import {
	parseArchiveMetric,
	type SessionArchiveItem,
	type SessionArchiveMetrics,
} from "./archive";
import {
	CAMPAIGN_SLUG,
	toPublishedSession,
	type PublishedSession,
} from "./model";

const publicMediaColumns =
	"cover_image_url:metadata->>coverImageUrl,hero_image_url:metadata->>heroImageUrl";
const columns = `source_session_id,title,session_date,arc,summary_short,${publicMediaColumns},status,campaigns!inner(slug)`;

const unavailableMetrics: SessionArchiveMetrics = {
	durationMs: null,
	wordCount: null,
	participantCount: null,
};

type ArchiveMetricRow = {
	source_session_id?: unknown;
	duration_ms?: unknown;
	word_count?: unknown;
	participant_count?: unknown;
};

export async function listPublishedSessions(): Promise<
	PublishedSession[] | null
> {
	const client = publishedDataClient();
	if (!client) return null;
	const { data, error } = await client
		.from("sessions")
		.select(columns)
		.eq("status", "published")
		.eq("campaigns.slug", CAMPAIGN_SLUG)
		.order("session_date", { ascending: false, nullsFirst: false })
		.order("source_session_id", { ascending: true })
		.limit(500);
	if (error) throw new Error("Published sessions unavailable");
	return (data ?? []).flatMap((row) => {
		const item = toPublishedSession(row);
		return item ? [item] : [];
	});
}

export async function listPublishedSessionArchive(): Promise<
	SessionArchiveItem[] | null
> {
	const sessions = await listPublishedSessions();
	if (!sessions?.length) return sessions;

	const client = publishedDataClient();
	if (!client) return null;

	const { data, error } = await client.rpc("public_session_archive_metrics", {
		target_campaign_slug: CAMPAIGN_SLUG,
	});

	if (error || !Array.isArray(data)) {
		return sessions.map((session) => ({ ...session, ...unavailableMetrics }));
	}

	const metrics = new Map<string, SessionArchiveMetrics>();
	for (const value of data as ArchiveMetricRow[]) {
		const sourceId =
			typeof value.source_session_id === "string"
				? value.source_session_id.trim()
				: "";
		if (!sourceId || metrics.has(sourceId)) continue;
		metrics.set(sourceId, {
			durationMs: parseArchiveMetric(value.duration_ms),
			wordCount: parseArchiveMetric(value.word_count),
			participantCount: parseArchiveMetric(value.participant_count),
		});
	}

	return sessions.map((session) => ({
		...session,
		...(metrics.get(session.id) ?? unavailableMetrics),
	}));
}

export const findPublishedSession = cache(async (id: string) => {
	if (!id || id.length > 220) return null;
	const client = publishedDataClient();
	if (!client) return null;
	const { data, error } = await client
		.from("sessions")
		.select(
			`source_session_id,title,session_date,arc,summary_short,summary_full,${publicMediaColumns},status,campaigns!inner(slug)`,
		)
		.eq("status", "published")
		.eq("campaigns.slug", CAMPAIGN_SLUG)
		.eq("source_session_id", id)
		.maybeSingle();
	if (error) throw new Error("Published session unavailable");
	return data ? toPublishedSession(data, true) : null;
});
