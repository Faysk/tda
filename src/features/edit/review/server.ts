import "server-only";

import { authorizeCampaignCapabilityServer } from "@/features/auth/server";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import { editDataClient } from "@/integrations/supabase/server";

const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SOURCE_PREVIEW_LIMIT = 3;
const SOURCE_TEXT_LIMIT = 1200;
const SOURCE_BATCH_SIZE = 100;

export type CanonReviewSource = Readonly<{
	kind: "transcript" | "roll20";
	label: string;
	text: string;
	startMs: number | null;
	reviewStatus: string | null;
}>;

export type CanonReviewCandidate = Readonly<{
	id: string;
	title: string;
	claim: string;
	candidateType: string;
	confidence: number | null;
	createdAt: string | null;
	sessionTitle: string | null;
	sessionDate: string | null;
	sourceCount: number;
	sources: readonly CanonReviewSource[];
}>;

export type CanonReviewQueueFailure =
	| "unauthenticated"
	| "profile_unresolved"
	| "forbidden"
	| "dependency_unavailable";

export type CanonReviewQueueResult =
	| Readonly<{ ok: true; candidates: readonly CanonReviewCandidate[] }>
	| Readonly<{ ok: false; reason: CanonReviewQueueFailure }>;

function numericConfidence(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return null;
}

function uuidArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter(
		(item): item is string =>
			typeof item === "string" && UUID_PATTERN.test(item),
	);
}

function shortText(value: unknown, fallback: string) {
	if (typeof value !== "string") return fallback;
	const normalized = value.trim();
	if (!normalized) return fallback;
	return normalized.slice(0, SOURCE_TEXT_LIMIT);
}

function chunks<T>(values: readonly T[], size: number): T[][] {
	const result: T[][] = [];
	for (let index = 0; index < values.length; index += size) {
		result.push(values.slice(index, index + size));
	}
	return result;
}

function candidatePreviewIds(candidate: {
	source_segment_ids: unknown;
	source_roll20_event_ids: unknown;
}) {
	const segments = uuidArray(candidate.source_segment_ids);
	const roll20 = uuidArray(candidate.source_roll20_event_ids);
	const selectedSegments = segments.slice(0, SOURCE_PREVIEW_LIMIT);
	const remaining = Math.max(0, SOURCE_PREVIEW_LIMIT - selectedSegments.length);
	return {
		segments,
		roll20,
		selectedSegments,
		selectedRoll20: roll20.slice(0, remaining),
	};
}

export async function loadCanonReviewQueue(): Promise<CanonReviewQueueResult> {
	const access = await authorizeCampaignCapabilityServer({
		action: EDIT_CAPABILITIES.reviewRead,
		campaignSlug: CAMPAIGN_SLUG,
	});
	if (!access.ok) return { ok: false, reason: access.reason };

	const client = editDataClient();
	if (!client) return { ok: false, reason: "dependency_unavailable" };

	const { data: campaign, error: campaignError } = await client
		.from("campaigns")
		.select("id")
		.eq("slug", CAMPAIGN_SLUG)
		.maybeSingle();
	if (campaignError || !campaign?.id) {
		console.error("Canon review campaign lookup failed");
		return { ok: false, reason: "dependency_unavailable" };
	}

	const { data: sessions, error: sessionsError } = await client
		.from("sessions")
		.select("id,title,session_date")
		.eq("campaign_id", campaign.id);
	if (sessionsError) {
		console.error("Canon review session lookup failed");
		return { ok: false, reason: "dependency_unavailable" };
	}

	const sessionRows = sessions ?? [];
	if (!sessionRows.length) return { ok: true, candidates: [] };
	const sessionIds = sessionRows.map((session) => session.id);

	const sessionById = new Map(
		sessionRows.map((session) => [
			session.id,
			{ title: session.title ?? null, date: session.session_date ?? null },
		]),
	);
	const { data: candidates, error: candidatesError } = await client
		.from("canon_candidates")
		.select(
			"id,session_id,title,claim,candidate_type,confidence,created_at,source_segment_ids,source_roll20_event_ids",
		)
		.in("session_id", sessionIds)
		.eq("status", "candidate")
		.order("created_at", { ascending: true })
		.limit(200);

	if (candidatesError) {
		console.error("Canon review candidate lookup failed");
		return { ok: false, reason: "dependency_unavailable" };
	}

	const candidateRows = candidates ?? [];
	const previewIds = candidateRows.map((candidate) => ({
		candidate,
		ids: candidatePreviewIds(candidate),
	}));
	const segmentIds = [
		...new Set(previewIds.flatMap(({ ids }) => ids.selectedSegments)),
	];
	const roll20Ids = [
		...new Set(previewIds.flatMap(({ ids }) => ids.selectedRoll20)),
	];
	const sourceByKey = new Map<string, CanonReviewSource>();

	for (const batch of chunks(segmentIds, SOURCE_BATCH_SIZE)) {
		const { data, error } = await client
			.from("transcript_segments")
			.select(
				"id,session_id,start_ms,end_ms,text,speaker_name,character_name,review_status",
			)
			.in("id", batch)
			.in("session_id", sessionIds);
		if (error) {
			console.error("Canon review transcript source lookup failed");
			return { ok: false, reason: "dependency_unavailable" };
		}
		for (const row of data ?? []) {
			const speaker =
				shortText(row.character_name, "") ||
				shortText(row.speaker_name, "") ||
				"Transcrição";
			sourceByKey.set("transcript:" + row.id, {
				kind: "transcript",
				label: speaker,
				text: shortText(row.text, "Trecho sem texto."),
				startMs:
					typeof row.start_ms === "number" && Number.isFinite(row.start_ms)
						? row.start_ms
						: null,
				reviewStatus:
					typeof row.review_status === "string" ? row.review_status : null,
			});
		}
	}

	for (const batch of chunks(roll20Ids, SOURCE_BATCH_SIZE)) {
		const { data, error } = await client
			.from("roll20_events")
			.select(
				"id,session_id,event_type,roll20_who,character_name,approx_start_ms,text",
			)
			.in("id", batch)
			.in("session_id", sessionIds);
		if (error) {
			console.error("Canon review Roll20 source lookup failed");
			return { ok: false, reason: "dependency_unavailable" };
		}
		for (const row of data ?? []) {
			const who =
				shortText(row.character_name, "") ||
				shortText(row.roll20_who, "") ||
				shortText(row.event_type, "Roll20");
			sourceByKey.set("roll20:" + row.id, {
				kind: "roll20",
				label: who,
				text: shortText(row.text, "Evento sem texto."),
				startMs:
					typeof row.approx_start_ms === "number" &&
					Number.isFinite(row.approx_start_ms)
						? row.approx_start_ms
						: null,
				reviewStatus: null,
			});
		}
	}

	return {
		ok: true,
		candidates: previewIds.map(({ candidate, ids }) => {
			const session = sessionById.get(candidate.session_id);
			const sources = [
				...ids.selectedSegments.map((id) =>
					sourceByKey.get("transcript:" + id),
				),
				...ids.selectedRoll20.map((id) => sourceByKey.get("roll20:" + id)),
			].filter((source): source is CanonReviewSource => Boolean(source));
			return {
				id: candidate.id,
				title: candidate.title,
				claim: candidate.claim,
				candidateType: candidate.candidate_type,
				confidence: numericConfidence(candidate.confidence),
				createdAt: candidate.created_at ?? null,
				sessionTitle: session?.title ?? null,
				sessionDate: session?.date ?? null,
				sourceCount: ids.segments.length + ids.roll20.length,
				sources,
			};
		}),
	};
}
