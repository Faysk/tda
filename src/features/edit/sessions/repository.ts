import "server-only";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import { editDataClient } from "@/integrations/supabase/server";
import { requireUnsafeEdit } from "../unsafe-access";
import type { EditSessionLibraryItem, SessionLibraryThumbnail } from "./library";
import {
	isExistingPublishedSessionCoverReference,
	isSessionCoverUuid,
	sessionCoverPreviewUrl,
} from "./session-cover-media";

export type EditSessionSummary = Readonly<{
	id: string;
	sourceSessionId: string;
	title: string;
	sessionDate: string | null;
	arc: string | null;
	status: string;
}>;

type SessionRow = Readonly<{
	id: string;
	source_session_id: string | null;
	title: string;
	session_date: string | null;
	arc: string | null;
	status: string;
	current_transcript_revision_id?: string | null;
	current_editorial_draft_id?: string | null;
	cover_image_url?: string | null;
}>;

type EditorialDraftRow = Readonly<{
	id: string;
	session_id: string;
	cover_asset_id: string | null;
}>;

type CoverAssetRow = Readonly<{
	id: string;
	status: string;
	role_hint: string;
	read_back_verified: boolean;
}>;

type SessionLibrarySeed = Readonly<{
	item: Omit<EditSessionLibraryItem, "thumbnail">;
	sessionId: string;
	currentDraftId: string | null;
	publicCoverReference: string | null;
}>;

const SUPPORTED_PAGE_SIZE = 200;
const SUPPORTED_RELATED_PAGE_SIZE = 200;
const SUPPORTED_LIBRARY_COLUMNS =
	"id,source_session_id,title,session_date,arc,status,current_transcript_revision_id,current_editorial_draft_id,cover_image_url:metadata->>coverImageUrl,campaigns!inner(slug)";

function dataClientOrThrow() {
	const client = editDataClient();
	if (!client) throw new Error("Edit data connection is unavailable");
	return client;
}

function unsafeClientOrThrow() {
	requireUnsafeEdit();
	return dataClientOrThrow();
}

function toSession(row: SessionRow): EditSessionSummary | null {
	const id = String(row.id || "").trim();
	const sourceSessionId = String(row.source_session_id || "").trim();
	if (!id || !sourceSessionId) return null;
	return {
		id,
		sourceSessionId,
		title: String(row.title || sourceSessionId).trim() || sourceSessionId,
		sessionDate: row.session_date || null,
		arc: row.arc ? String(row.arc).trim() || null : null,
		status: String(row.status || "unknown"),
	};
}

function cleanReference(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const reference = value.trim();
	return reference || null;
}

function toLibrarySeed(row: SessionRow): SessionLibrarySeed | null {
	const session = toSession(row);
	if (!session) return null;
	return {
		item: {
			...session,
			transcriptPrepared: Boolean(row.current_transcript_revision_id),
		},
		sessionId: session.id,
		currentDraftId: cleanReference(row.current_editorial_draft_id),
		publicCoverReference: cleanReference(row.cover_image_url),
	};
}

function publicThumbnail(reference: string | null): SessionLibraryThumbnail | null {
	if (!reference || !isExistingPublishedSessionCoverReference(reference)) return null;
	return { src: reference, kind: "public" };
}

function privateThumbnail(
	sessionId: string,
	assetId: string,
): SessionLibraryThumbnail | null {
	const src = sessionCoverPreviewUrl(sessionId, assetId);
	return src ? { src, kind: "private" } : null;
}

/**
 * Supported metadata-only read model for the private Edit session library.
 *
 * Authorization is deliberately owned by the server page boundary before this
 * function is called. This query still constrains every page to the authorized
 * campaign and never selects transcript text, summary_full, media bytes or
 * revision payloads.
 */
export async function listEditSessionLibrary(
	campaignSlug: string,
): Promise<EditSessionLibraryItem[]> {
	if (!/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/u.test(campaignSlug))
		throw new Error("Invalid campaign");
	const client = dataClientOrThrow();
	const seeds: SessionLibrarySeed[] = [];
	let after: string | null = null;

	while (true) {
		let query = client
			.from("sessions")
			.select(SUPPORTED_LIBRARY_COLUMNS)
			.eq("campaigns.slug", campaignSlug)
			.order("id", { ascending: true })
			.limit(SUPPORTED_PAGE_SIZE);
		if (after) query = query.gt("id", after);

		const { data, error } = await query;
		if (error) throw new Error("Edit sessions unavailable");
		const rows = (data ?? []) as unknown as SessionRow[];
		if (!rows.length) break;

		for (const row of rows) {
			if (!row.id || (after !== null && row.id <= after))
				throw new Error("Non-progressing session library cursor");
			const seed = toLibrarySeed(row);
			if (seed) seeds.push(seed);
			after = row.id;
		}

		if (rows.length < SUPPORTED_PAGE_SIZE) break;
	}

	const draftIds = Array.from(
		new Set(
			seeds
				.map((seed) => seed.currentDraftId)
				.filter((id): id is string => Boolean(id)),
		),
	);
	const draftById = new Map<string, EditorialDraftRow>();
	for (let start = 0; start < draftIds.length; start += SUPPORTED_RELATED_PAGE_SIZE) {
		const ids = draftIds.slice(start, start + SUPPORTED_RELATED_PAGE_SIZE);
		const { data, error } = await client
			.from("session_editorial_drafts")
			.select("id,session_id,cover_asset_id")
			.in("id", ids);
		if (error) throw new Error("Edit session draft thumbnails unavailable");
		for (const row of (data ?? []) as unknown as EditorialDraftRow[]) {
			if (row?.id && row?.session_id) draftById.set(row.id, row);
		}
	}

	const privateAssetIds = Array.from(
		new Set(
			Array.from(draftById.values())
				.map((draft) => cleanReference(draft.cover_asset_id))
				.filter((reference): reference is string => Boolean(reference))
				.filter(isSessionCoverUuid),
		),
	);
	const readablePrivateAssets = new Set<string>();
	for (
		let start = 0;
		start < privateAssetIds.length;
		start += SUPPORTED_RELATED_PAGE_SIZE
	) {
		const ids = privateAssetIds.slice(start, start + SUPPORTED_RELATED_PAGE_SIZE);
		const { data, error } = await client
			.from("media_assets")
			.select("id,status,role_hint,read_back_verified")
			.in("id", ids);
		if (error) throw new Error("Edit session cover thumbnails unavailable");
		for (const row of (data ?? []) as unknown as CoverAssetRow[]) {
			if (
				row?.id &&
				row.role_hint === "session_cover" &&
				row.read_back_verified === true &&
				row.status !== "retired"
			) {
				readablePrivateAssets.add(row.id);
			}
		}
	}

	return seeds.map((seed) => {
		let thumbnail: SessionLibraryThumbnail | null = null;
		const draft = seed.currentDraftId ? draftById.get(seed.currentDraftId) : undefined;
		if (draft?.session_id === seed.sessionId) {
			const draftCover = cleanReference(draft.cover_asset_id);
			if (draftCover && isSessionCoverUuid(draftCover)) {
				if (readablePrivateAssets.has(draftCover))
					thumbnail = privateThumbnail(seed.sessionId, draftCover);
			} else {
				thumbnail = publicThumbnail(draftCover);
			}
		}
		thumbnail ??= publicThumbnail(seed.publicCoverReference);
		return { ...seed.item, thumbnail };
	});
}

export async function findEditSessionBySourceId(
	campaignSlug: string,
	sourceSessionId: string,
): Promise<EditSessionSummary | null> {
	if (!/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/u.test(campaignSlug))
		throw new Error("Invalid campaign");
	if (!sourceSessionId || sourceSessionId.length > 220) return null;
	const client = dataClientOrThrow();
	const { data, error } = await client
		.from("sessions")
		.select("id,source_session_id,title,session_date,arc,status,campaigns!inner(slug)")
		.eq("campaigns.slug", campaignSlug)
		.eq("source_session_id", sourceSessionId)
		.maybeSingle();
	if (error) throw new Error("Edit session lookup unavailable");
	return data ? toSession(data as unknown as SessionRow) : null;
}

export type EditSessionCampaignIdentity = Readonly<{
	sessionId: string;
	sourceSessionId: string;
	campaignId: string;
	technicalSlug: string;
	routeKey: string;
	campaignName: string;
	lifecycle: "active" | "archived";
}>;

export async function resolveEditSessionCampaign(
	sessionId: string,
): Promise<EditSessionCampaignIdentity | null> {
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(sessionId))
		return null;
	const client = dataClientOrThrow();
	const { data: session, error: sessionError } = await client
		.from("sessions")
		.select("id,campaign_id,source_session_id")
		.eq("id", sessionId)
		.maybeSingle();
	if (sessionError) throw new Error("Edit session campaign lookup unavailable");
	if (!session?.id || !session.campaign_id || !session.source_session_id) return null;

	const { data: campaign, error: campaignError } = await client
		.from("campaigns")
		.select("id,slug,public_slug,name,lifecycle")
		.eq("id", session.campaign_id)
		.maybeSingle();
	if (campaignError) throw new Error("Edit campaign identity lookup unavailable");
	if (
		!campaign?.id ||
		typeof campaign.slug !== "string" ||
		typeof campaign.public_slug !== "string" ||
		typeof campaign.name !== "string" ||
		(campaign.lifecycle !== "active" && campaign.lifecycle !== "archived")
	) return null;

	return {
		sessionId: String(session.id),
		sourceSessionId: String(session.source_session_id),
		campaignId: String(campaign.id),
		technicalSlug: campaign.slug,
		routeKey: campaign.public_slug,
		campaignName: campaign.name,
		lifecycle: campaign.lifecycle,
	};
}

export async function listUnsafeEditSessions(): Promise<EditSessionSummary[]> {
	const client = unsafeClientOrThrow();
	const { data, error } = await client
		.from("sessions")
		.select("id,source_session_id,title,session_date,arc,status,campaigns!inner(slug)")
		.eq("campaigns.slug", CAMPAIGN_SLUG)
		.order("session_date", { ascending: false, nullsFirst: false })
		.order("source_session_id", { ascending: true })
		.limit(250);
	if (error) throw new Error("Edit sessions unavailable");
	return ((data ?? []) as unknown as SessionRow[]).flatMap((row) => {
		const session = toSession(row);
		return session ? [session] : [];
	});
}

export async function findUnsafeEditSessionBySourceId(
	sourceSessionId: string,
): Promise<EditSessionSummary | null> {
	if (!sourceSessionId || sourceSessionId.length > 220) return null;
	const client = unsafeClientOrThrow();
	const { data, error } = await client
		.from("sessions")
		.select("id,source_session_id,title,session_date,arc,status,campaigns!inner(slug)")
		.eq("campaigns.slug", CAMPAIGN_SLUG)
		.eq("source_session_id", sourceSessionId)
		.maybeSingle();
	if (error) throw new Error("Edit session lookup unavailable");
	return data ? toSession(data as unknown as SessionRow) : null;
}

export async function countUnsafeEditTranscriptSegments(sessionId: string): Promise<number> {
	const client = unsafeClientOrThrow();
	const { count, error } = await client
		.from("transcript_segments")
		.select("id", { count: "exact", head: true })
		.eq("session_id", sessionId);
	if (error) throw new Error("Transcript count unavailable");
	return count ?? 0;
}
