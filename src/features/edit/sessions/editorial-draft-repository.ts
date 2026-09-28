import "server-only";

import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import { editDataClient } from "@/integrations/supabase/server";
import type { SessionEditorialDraft, SessionEditorialDraftInput } from "./editorial-draft-model";

type SessionRow = Readonly<{
	id: unknown;
	status: unknown;
	session_date: unknown;
	title: unknown;
	arc: unknown;
	summary_short: unknown;
	summary_full: unknown;
	cover_image_url: unknown;
	current_transcript_revision_id: unknown;
	current_editorial_draft_id: unknown;
}>;

type DraftRow = Readonly<{
	id: unknown;
	revision: unknown;
	base_transcript_revision_id: unknown;
	cover_asset_id: unknown;
	arc: unknown;
	title: unknown;
	summary_short: unknown;
	summary_full: unknown;
	session_date: unknown;
	created_at: unknown;
}>;

function text(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function requiredId(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 && value.length <= 100
		? value
		: null;
}

export async function readSessionEditorialDraft(
	sessionId: string,
): Promise<SessionEditorialDraft | null> {
	const client = editDataClient();
	if (!client) throw new Error("Edit data connection is unavailable");

	const { data: sessionRaw, error: sessionError } = await client
		.from("sessions")
		.select(
			"id,status,session_date,title,arc,summary_short,summary_full,cover_image_url:metadata->>coverImageUrl,current_transcript_revision_id,current_editorial_draft_id,campaigns!inner(slug)",
		)
		.eq("id", sessionId)
		.eq("campaigns.slug", CAMPAIGN_SLUG)
		.maybeSingle();
	if (sessionError) throw new Error("Editorial session lookup unavailable");
	if (!sessionRaw) return null;

	const session = sessionRaw as unknown as SessionRow;
	const currentTranscriptRevisionId = requiredId(session.current_transcript_revision_id);
	if (!currentTranscriptRevisionId) return null;

	const draftId = requiredId(session.current_editorial_draft_id);
	if (!draftId) {
		return {
			draftId: null,
			revision: 0,
			baseTranscriptRevisionId: currentTranscriptRevisionId,
			currentTranscriptRevisionId,
			transcriptChanged: false,
			coverAssetId: text(session.cover_image_url),
			arc: text(session.arc),
			title: text(session.title),
			shortDescription: text(session.summary_short),
			fullSummary: text(session.summary_full),
			updatedAt: null,
			sessionStatus: text(session.status) || "unknown",
			sessionDate: text(session.session_date) || null,
			seededFromPublished: text(session.status) === "published",
		};
	}

	const { data: draftRaw, error: draftError } = await client
		.from("session_editorial_drafts")
		.select(
			"id,revision,base_transcript_revision_id,cover_asset_id,arc,title,summary_short,summary_full,session_date,created_at",
		)
		.eq("id", draftId)
		.eq("session_id", sessionId)
		.maybeSingle();
	if (draftError) throw new Error("Editorial draft lookup unavailable");
	if (!draftRaw) throw new Error("Editorial draft pointer is inconsistent");

	const draft = draftRaw as unknown as DraftRow;
	const baseTranscriptRevisionId = requiredId(draft.base_transcript_revision_id);
	const parsedDraftId = requiredId(draft.id);
	const revision =
		typeof draft.revision === "number" &&
		Number.isSafeInteger(draft.revision) &&
		draft.revision > 0
			? draft.revision
			: null;
	const updatedAt = text(draft.created_at);
	if (!baseTranscriptRevisionId || !parsedDraftId || revision === null || !updatedAt)
		throw new Error("Editorial draft metadata is invalid");

	return {
		draftId: parsedDraftId,
		revision,
		baseTranscriptRevisionId,
		currentTranscriptRevisionId,
		transcriptChanged: baseTranscriptRevisionId !== currentTranscriptRevisionId,
		coverAssetId: text(draft.cover_asset_id),
		arc: text(draft.arc),
		title: text(draft.title),
		shortDescription: text(draft.summary_short),
		fullSummary: text(draft.summary_full),
		updatedAt,
		sessionStatus: text(session.status) || "unknown",
		sessionDate: text(draft.session_date) || null,
		seededFromPublished: false,
	};
}

export async function persistSessionEditorialDraft(
	actorProfileId: string,
	input: SessionEditorialDraftInput,
) {
	const client = editDataClient();
	if (!client) return { ok: false as const, reason: "dependency_unavailable" as const };

	const { data, error } = await client.rpc("save_session_editorial_draft_atomic", {
		p_actor_profile_id: actorProfileId,
		p_campaign_slug: CAMPAIGN_SLUG,
		p_session_id: input.sessionId,
		p_expected_revision: input.expectedRevision,
		p_base_transcript_revision_id: input.baseTranscriptRevisionId,
		p_cover_asset_id: input.coverAssetId.trim() || null,
		p_arc: input.arc,
		p_title: input.title,
		p_summary_short: input.shortDescription,
		p_summary_full: input.fullSummary,
		p_session_date: input.sessionDate || null,
	});
	if (error || !Array.isArray(data) || data.length !== 1)
		return { ok: false as const, reason: "dependency_unavailable" as const };

	const row = data[0] as Record<string, unknown>;
	if (row.status === "conflict") {
		return {
			ok: false as const,
			reason: "conflict" as const,
			revision: typeof row.revision === "number" ? row.revision : null,
		};
	}
	if (row.status !== "updated" || typeof row.draft_id !== "string")
		return {
			ok: false as const,
			reason:
				row.status === "not_found" || row.status === "invalid_base"
					? row.status
					: "dependency_unavailable",
		} as const;
	if (typeof row.revision !== "number" || !Number.isSafeInteger(row.revision))
		return { ok: false as const, reason: "dependency_unavailable" as const };

	return {
		ok: true as const,
		draftId: row.draft_id,
		revision: row.revision,
	};
}
