export type TranscriptAbsoluteTime = Readonly<{
	schemaVersion: "tda_segment_absolute_time_v1";
	confidence: "trusted_absolute";
	sourceStart: string;
	start: string;
	end: string;
}>;

export type TranscriptReaderSegment = Readonly<{
	id: string;
	/** Stable source identity used only for private revision deltas. */
	sourceSegmentId?: string;
	trackNumber: number;
	startMs: number;
	endMs: number;
	absoluteTime?: TranscriptAbsoluteTime;
	speaker: string;
	text: string;
}>;

export type TranscriptReaderSnapshot = Readonly<{
	source: "current_revision" | "legacy_segments";
	revisionId: string | null;
	revisionNumber: number | null;
	segments: readonly TranscriptReaderSegment[];
	/** Exact private legacy source snapshot shown to the operator, when applicable. */
	legacySnapshotSha256?: string;
}>;

function finiteSeconds(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) && value >= 0
		? value
		: null;
}

const OFFSET_ISO =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;

function parseAbsoluteTime(value: unknown): TranscriptAbsoluteTime | undefined {
	if (value === undefined || value === null) return undefined;
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Transcript absolute time is invalid");
	const row = value as Record<string, unknown>;
	const sourceStart = typeof row.source_start === "string" ? row.source_start : "";
	const start = typeof row.start === "string" ? row.start : "";
	const end = typeof row.end === "string" ? row.end : "";
	if (
		row.schema_version !== "tda_segment_absolute_time_v1" ||
		row.confidence !== "trusted_absolute" ||
		!OFFSET_ISO.test(sourceStart) ||
		!OFFSET_ISO.test(start) ||
		!OFFSET_ISO.test(end) ||
		!Number.isFinite(Date.parse(sourceStart)) ||
		!Number.isFinite(Date.parse(start)) ||
		!Number.isFinite(Date.parse(end)) ||
		Date.parse(end) < Date.parse(start)
	)
		throw new Error("Transcript absolute time is invalid");
	return {
		schemaVersion: "tda_segment_absolute_time_v1",
		confidence: "trusted_absolute",
		sourceStart,
		start,
		end,
	};
}

export function normalizeRevisionSegments(raw: unknown): TranscriptReaderSegment[] {
	if (!Array.isArray(raw)) throw new Error("Transcript revision segments are invalid");
	const seen = new Set<string>();
	const segments = raw.map((value, index) => {
		if (!value || typeof value !== "object" || Array.isArray(value))
			throw new Error("Transcript revision segment is invalid");
		const row = value as Record<string, unknown>;
		const trackNumber = Number.isSafeInteger(row.track_number) ? Number(row.track_number) : null;
		const start = finiteSeconds(row.start);
		const end = finiteSeconds(row.end);
		const segmentId = typeof row.segment_id === "string" ? row.segment_id : "";
		const text = typeof row.text === "string" ? row.text : "";
		const speaker = typeof row.speaker === "string" ? row.speaker : "";
		const absoluteTime = parseAbsoluteTime(row.absolute_time);
		if (
			trackNumber === null ||
			trackNumber < 1 ||
			start === null ||
			end === null ||
			end < start ||
			!segmentId ||
			!text.trim() ||
			!speaker.trim()
		)
			throw new Error("Transcript revision segment is invalid");
		const identity = `${trackNumber}\u0000${segmentId}`;
		if (seen.has(identity)) throw new Error("Transcript revision contains duplicate segments");
		seen.add(identity);
		return {
			id: `r-${trackNumber}-${segmentId}`,
			sourceSegmentId: segmentId,
			trackNumber,
			startMs: Math.round(start * 1000),
			endMs: Math.round(end * 1000),
			...(absoluteTime ? { absoluteTime } : {}),
			speaker,
			text,
			_originalIndex: index,
		};
	});
	return segments
		.sort(
			(a, b) =>
				a.startMs - b.startMs ||
				a.endMs - b.endMs ||
				a.trackNumber - b.trackNumber ||
				(a.id < b.id ? -1 : a.id > b.id ? 1 : a._originalIndex - b._originalIndex),
		)
		.map(({ _originalIndex: _ignored, ...segment }) => segment);
}

export function sortLegacySegments(
	segments: readonly TranscriptReaderSegment[],
): TranscriptReaderSegment[] {
	return [...segments].sort(
		(a, b) =>
			a.startMs - b.startMs ||
			a.endMs - b.endMs ||
			a.trackNumber - b.trackNumber ||
			(a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
	);
}

export function formatTranscriptTimestamp(milliseconds: number, precise = true): string {
	const safe = Math.max(0, Math.round(milliseconds));
	const hours = Math.floor(safe / 3_600_000);
	const minutes = Math.floor((safe % 3_600_000) / 60_000);
	const seconds = Math.floor((safe % 60_000) / 1000);
	const base = [hours, minutes, seconds]
		.map((part) => String(part).padStart(2, "0"))
		.join(":");
	return precise ? `${base}.${String(safe % 1000).padStart(3, "0")}` : base;
}

export function formatTranscriptWallClock(
	value: TranscriptAbsoluteTime | undefined,
): string | null {
	if (!value) return null;
	const match = value.start.match(
		/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/u,
	);
	if (!match) return null;
	const millis = (match[7] ?? "").slice(0, 3).padEnd(3, "0");
	const offset = match[8] === "Z" ? "UTC" : match[8];
	return `${match[3]}/${match[2]} · ${match[4]}:${match[5]}:${match[6]}.${millis} ${offset}`;
}

export function parseTranscriptTimestamp(value: string): number | null {
	const match = value.trim().match(/^(?:(\d{1,4}):)?([0-5]?\d):([0-5]?\d)(?:\.(\d{1,3}))?$/u);
	if (!match) return null;
	const hours = Number(match[1] ?? 0);
	const minutes = Number(match[2]);
	const seconds = Number(match[3]);
	const millis = Number((match[4] ?? "").padEnd(3, "0") || 0);
	const result = ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis;
	return Number.isSafeInteger(result) ? result : null;
}

export function findTranscriptJumpIndex(
	segments: readonly TranscriptReaderSegment[],
	targetMs: number,
): number {
	if (!segments.length) return -1;
	let low = 0;
	let high = segments.length;
	while (low < high) {
		const mid = Math.floor((low + high) / 2);
		if (segments[mid].startMs < targetMs) low = mid + 1;
		else high = mid;
	}
	return Math.min(low, segments.length - 1);
}

export function sanitizeTranscriptFilenamePart(value: string): string {
	return value
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/gu, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, "-")
		.replace(/^-+|-+$/gu, "")
		.slice(0, 96) || "sessao";
}

export function transcriptMarkdownFilename(
	date: string | null,
	title: string,
	revisionNumber: number | null,
): string {
	const prefix = date && /^\d{4}-\d{2}-\d{2}/u.test(date) ? date.slice(0, 10) : "sessao";
	const revision = revisionNumber ? `-r${revisionNumber}` : "";
	return `${prefix}-${sanitizeTranscriptFilenamePart(title)}-transcricao${revision}.md`;
}

function markdownText(value: string): string {
	return value.replace(/\r\n?/gu, "\n").trim();
}

export function renderTranscriptMarkdown(input: {
	title: string;
	sessionDate: string | null;
	arc: string | null;
	sourceSessionId: string;
	snapshot: TranscriptReaderSnapshot;
}): string {
	const lines = [
		`# Transcrição — ${markdownText(input.title)}`,
		"",
		`Sessão: ${input.sessionDate ?? "data não informada"}`,
		`Arco: ${input.arc ?? "não informado"}`,
		`Origem: ${input.sourceSessionId}`,
		`Fonte: ${input.snapshot.source === "current_revision" ? `revision privada r${input.snapshot.revisionNumber ?? "?"}` : "transcript_segments legado"}`,
		"",
		"## Transcrição",
		"",
	];
	for (const segment of input.snapshot.segments) {
		const wallClock = formatTranscriptWallClock(segment.absoluteTime);
		lines.push(
			`[${formatTranscriptTimestamp(segment.startMs)}${wallClock ? ` · ${wallClock}` : ""}] **${markdownText(segment.speaker)}**`,
			markdownText(segment.text),
			"",
		);
	}
	return `${lines.join("\n").trimEnd()}\n`;
}
