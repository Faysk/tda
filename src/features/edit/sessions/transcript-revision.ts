import "server-only";

import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import { editDataClient } from "@/integrations/supabase/server";

export type SessionTranscriptSegment = Readonly<{
	trackNumber: number;
	segmentId: string;
	startSeconds: number;
	endSeconds: number;
	text: string;
	speaker: string;
	reviewed: boolean;
}>;

export type SessionTranscriptSnapshot = Readonly<{
	sessionId: string;
	sourceSessionId: string;
	title: string;
	sessionDate: string | null;
	arc: string | null;
	status: string;
	revisionId: string;
	revisionNumber: number;
	createdAt: string;
	segments: readonly SessionTranscriptSegment[];
}>;

type SessionRow = Readonly<{
	id: unknown;
	source_session_id: unknown;
	title: unknown;
	session_date: unknown;
	arc: unknown;
	status: unknown;
	current_transcript_revision_id: unknown;
}>;

type RevisionRow = Readonly<{
	id: unknown;
	session_id: unknown;
	source_session_id: unknown;
	revision_number: unknown;
	segments: unknown;
	created_at: unknown;
}>;

function safeText(value: unknown, max: number): string {
	if (typeof value !== "string") return "";
	const normalized = value.trim();
	return normalized.length <= max ? normalized : "";
}

function finiteNumber(value: unknown, min: number, max: number): number | null {
	return typeof value === "number" &&
		Number.isFinite(value) &&
		value >= min &&
		value <= max
		? value
		: null;
}

function parseSegments(value: unknown): SessionTranscriptSegment[] {
	if (!Array.isArray(value) || value.length > 100_000)
		throw new Error("Transcript revision segments are invalid");

	const segments = value.map((raw) => {
		if (!raw || typeof raw !== "object" || Array.isArray(raw))
			throw new Error("Transcript revision segment is invalid");
		const row = raw as Record<string, unknown>;
		const trackNumber = finiteNumber(row.track_number, 1, 9999);
		const startSeconds = finiteNumber(row.start, 0, 604_800);
		const endSeconds = finiteNumber(row.end, 0, 604_800);
		const segmentId = safeText(row.segment_id, 256);
		const text = typeof row.text === "string" ? row.text : "";
		const speaker = safeText(row.speaker, 160);
		if (
			trackNumber === null ||
			!Number.isInteger(trackNumber) ||
			startSeconds === null ||
			endSeconds === null ||
			endSeconds < startSeconds ||
			!segmentId ||
			!text.trim() ||
			!speaker ||
			typeof row.reviewed !== "boolean"
		) {
			throw new Error("Transcript revision segment does not match the contract");
		}
		return {
			trackNumber,
			segmentId,
			startSeconds,
			endSeconds,
			text,
			speaker,
			reviewed: row.reviewed,
		};
	});

	return segments.sort(
		(left, right) =>
			left.startSeconds - right.startSeconds ||
			left.endSeconds - right.endSeconds ||
			left.trackNumber - right.trackNumber ||
			left.segmentId.localeCompare(right.segmentId, "en"),
	);
}

export async function readPreparedSessionTranscript(
	sourceSessionId: string,
): Promise<SessionTranscriptSnapshot | null> {
	const normalizedSource = sourceSessionId.trim();
	if (!normalizedSource || normalizedSource.length > 220) return null;

	const client = editDataClient();
	if (!client) throw new Error("Edit data connection is unavailable");

	const { data: sessionRaw, error: sessionError } = await client
		.from("sessions")
		.select(
			"id,source_session_id,title,session_date,arc,status,current_transcript_revision_id,campaigns!inner(slug)",
		)
		.eq("campaigns.slug", CAMPAIGN_SLUG)
		.eq("source_session_id", normalizedSource)
		.maybeSingle();
	if (sessionError) throw new Error("Edit session lookup unavailable");
	if (!sessionRaw) return null;

	const session = sessionRaw as unknown as SessionRow;
	const sessionId = safeText(session.id, 80);
	const sourceId = safeText(session.source_session_id, 220);
	const currentRevisionId = safeText(session.current_transcript_revision_id, 80);
	if (!sessionId || !sourceId || !currentRevisionId) return null;

	const { data: revisionRaw, error: revisionError } = await client
		.from("transcript_revisions")
		.select("id,session_id,source_session_id,revision_number,segments,created_at")
		.eq("id", currentRevisionId)
		.eq("session_id", sessionId)
		.eq("source_session_id", sourceId)
		.maybeSingle();
	if (revisionError) throw new Error("Current transcript revision unavailable");
	if (!revisionRaw) throw new Error("Current transcript revision is inconsistent");

	const revision = revisionRaw as unknown as RevisionRow;
	const revisionId = safeText(revision.id, 80);
	const revisionSessionId = safeText(revision.session_id, 80);
	const revisionSourceId = safeText(revision.source_session_id, 220);
	const revisionNumber =
		typeof revision.revision_number === "number" &&
		Number.isSafeInteger(revision.revision_number) &&
		revision.revision_number > 0
			? revision.revision_number
			: null;
	const createdAt = safeText(revision.created_at, 80);
	if (
		!revisionId ||
		revisionSessionId !== sessionId ||
		revisionSourceId !== sourceId ||
		revisionNumber === null ||
		!createdAt ||
		!Number.isFinite(Date.parse(createdAt))
	) {
		throw new Error("Current transcript revision metadata is invalid");
	}

	return {
		sessionId,
		sourceSessionId: sourceId,
		title: safeText(session.title, 500) || sourceId,
		sessionDate: safeText(session.session_date, 10) || null,
		arc: safeText(session.arc, 300) || null,
		status: safeText(session.status, 80) || "unknown",
		revisionId,
		revisionNumber,
		createdAt,
		segments: parseSegments(revision.segments),
	};
}

function formatTimestamp(seconds: number): string {
	const totalMilliseconds = Math.max(0, Math.round(seconds * 1000));
	const milliseconds = totalMilliseconds % 1000;
	const totalSeconds = Math.floor(totalMilliseconds / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const secs = totalSeconds % 60;
	return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

export function transcriptMarkdown(snapshot: SessionTranscriptSnapshot): string {
	const lines = [
		`# Transcrição — ${snapshot.title}`,
		"",
		snapshot.sessionDate ? `Sessão: ${snapshot.sessionDate}` : null,
		snapshot.arc ? `Arco: ${snapshot.arc}` : null,
		`Origem: ${snapshot.sourceSessionId}`,
		`Revisão: ${snapshot.revisionNumber}`,
		"",
		"## Transcrição",
		"",
	].filter((line): line is string => line !== null);

	for (const segment of snapshot.segments) {
		lines.push(
			`[${formatTimestamp(segment.startSeconds)}] **${segment.speaker}**`,
			segment.text,
			"",
		);
	}
	return `${lines.join("\n").trimEnd()}\n`;
}

export function transcriptFilename(snapshot: SessionTranscriptSnapshot): string {
	const date = /^\d{4}-\d{2}-\d{2}$/u.test(snapshot.sessionDate || "")
		? snapshot.sessionDate
		: "sessao";
	const slug = snapshot.title
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/gu, "")
		.toLocaleLowerCase("pt-BR")
		.replace(/[^a-z0-9]+/gu, "-")
		.replace(/^-+|-+$/gu, "")
		.slice(0, 96);
	return `${date}-${slug || "transcricao"}-transcricao.md`;
}
