import "server-only";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import { editDataClient } from "@/integrations/supabase/server";
import { requireUnsafeEdit } from "../unsafe-access";
import type { EditSessionLibraryItem } from "./library";

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
}>;

const SUPPORTED_PAGE_SIZE = 200;
const SUPPORTED_LIBRARY_COLUMNS =
	"id,source_session_id,title,session_date,arc,status,current_transcript_revision_id,campaigns!inner(slug)";

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

function toLibrarySession(row: SessionRow): EditSessionLibraryItem | null {
	const session = toSession(row);
	if (!session) return null;
	return {
		...session,
		transcriptPrepared: Boolean(row.current_transcript_revision_id),
	};
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
	const sessions: EditSessionLibraryItem[] = [];
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
			const session = toLibrarySession(row);
			if (session) sessions.push(session);
			after = row.id;
		}

		if (rows.length < SUPPORTED_PAGE_SIZE) break;
	}

	return sessions;
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
