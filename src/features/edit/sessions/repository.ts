import "server-only";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import { editDataClient } from "@/integrations/supabase/server";
import { requireUnsafeEdit } from "../unsafe-access";

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
}>;

function clientOrThrow() {
	requireUnsafeEdit();
	const client = editDataClient();
	if (!client) throw new Error("Edit data connection is unavailable");
	return client;
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

export async function listUnsafeEditSessions(): Promise<EditSessionSummary[]> {
	const client = clientOrThrow();
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
	const client = clientOrThrow();
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
	const client = clientOrThrow();
	const { count, error } = await client
		.from("transcript_segments")
		.select("id", { count: "exact", head: true })
		.eq("session_id", sessionId);
	if (error) throw new Error("Transcript count unavailable");
	return count ?? 0;
}
