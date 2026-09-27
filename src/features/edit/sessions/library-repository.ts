import "server-only";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import { editDataClient } from "@/integrations/supabase/server";
import type { EditSessionLibraryItem } from "./library-model";

type SessionRow = Readonly<{
	id: string;
	source_session_id: string | null;
	title: string;
	session_date: string | null;
	arc: string | null;
	status: string;
	current_transcript_revision_id: string | null;
}>;

type RevisionRow = Readonly<{
	id: string;
	revision_number: number;
	created_at: string;
}>;

const LIBRARY_LIMIT = 500;
const REVISION_BATCH_SIZE = 100;

function clientOrThrow() {
	const client = editDataClient();
	if (!client) throw new Error("Edit data connection is unavailable");
	return client;
}

function toSession(row: SessionRow) {
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
		currentTranscriptRevisionId:
			typeof row.current_transcript_revision_id === "string"
				? row.current_transcript_revision_id
				: null,
	};
}

function toRevision(row: RevisionRow) {
	if (
		typeof row.id !== "string" ||
		typeof row.revision_number !== "number" ||
		!Number.isSafeInteger(row.revision_number) ||
		row.revision_number <= 0 ||
		typeof row.created_at !== "string"
	) {
		throw new Error("Transcript revision metadata does not match the Edit contract");
	}
	return { id: row.id, revisionNumber: row.revision_number, createdAt: row.created_at };
}

export async function listEditSessionLibrary(): Promise<EditSessionLibraryItem[]> {
	const client = clientOrThrow();
	const { data, error } = await client
		.from("sessions")
		.select("id,source_session_id,title,session_date,arc,status,current_transcript_revision_id,campaigns!inner(slug)")
		.eq("campaigns.slug", CAMPAIGN_SLUG)
		.order("session_date", { ascending: false, nullsFirst: false })
		.order("source_session_id", { ascending: true })
		.limit(LIBRARY_LIMIT);
	if (error) throw new Error("Edit sessions unavailable");

	const sessions = ((data ?? []) as unknown as SessionRow[]).flatMap((row) => {
		const session = toSession(row);
		return session ? [session] : [];
	});
	const revisionIds = [
		...new Set(
			sessions
				.map((session) => session.currentTranscriptRevisionId)
				.filter((value): value is string => Boolean(value)),
		),
	];
	const revisions = new Map<string, Readonly<{ revisionNumber: number; createdAt: string }>>();

	for (let index = 0; index < revisionIds.length; index += REVISION_BATCH_SIZE) {
		const batch = revisionIds.slice(index, index + REVISION_BATCH_SIZE);
		const { data: rows, error: revisionError } = await client
			.from("transcript_revisions")
			.select("id,revision_number,created_at")
			.in("id", batch);
		if (revisionError) throw new Error("Transcript revision metadata unavailable");
		for (const raw of (rows ?? []) as unknown as RevisionRow[]) {
			const revision = toRevision(raw);
			revisions.set(revision.id, {
				revisionNumber: revision.revisionNumber,
				createdAt: revision.createdAt,
			});
		}
	}

	return sessions.map((session) => {
		const revisionId = session.currentTranscriptRevisionId;
		const revision = revisionId ? revisions.get(revisionId) : null;
		if (revisionId && !revision)
			throw new Error("Current transcript revision metadata unavailable");
		return {
			id: session.id,
			sourceSessionId: session.sourceSessionId,
			title: session.title,
			sessionDate: session.sessionDate,
			arc: session.arc,
			status: session.status,
			transcriptRevisionNumber: revision?.revisionNumber ?? null,
			transcriptRevisionCreatedAt: revision?.createdAt ?? null,
		};
	});
}
