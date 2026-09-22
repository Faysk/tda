import "server-only";

import { authorizeCampaignCapabilityServer } from "@/features/auth/server";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import { editDataClient } from "@/integrations/supabase/server";

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

function sourceCount(value: unknown): number {
	return Array.isArray(value) ? value.length : 0;
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
		.in(
			"session_id",
			sessionRows.map((session) => session.id),
		)
		.eq("status", "candidate")
		.order("created_at", { ascending: true })
		.limit(200);

	if (candidatesError) {
		console.error("Canon review candidate lookup failed");
		return { ok: false, reason: "dependency_unavailable" };
	}

	return {
		ok: true,
		candidates: (candidates ?? []).map((candidate) => {
			const session = sessionById.get(candidate.session_id);
			return {
				id: candidate.id,
				title: candidate.title,
				claim: candidate.claim,
				candidateType: candidate.candidate_type,
				confidence: numericConfidence(candidate.confidence),
				createdAt: candidate.created_at ?? null,
				sessionTitle: session?.title ?? null,
				sessionDate: session?.date ?? null,
				sourceCount:
					sourceCount(candidate.source_segment_ids) +
					sourceCount(candidate.source_roll20_event_ids),
			};
		}),
	};
}
