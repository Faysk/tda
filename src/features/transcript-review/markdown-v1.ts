export const TDA_TRANSCRIPT_MARKDOWN_SCHEMA = "tda_transcript_markdown_v1" as const;

const HEADER_PREFIX = "<!-- tda:transcript ";
const SEGMENT_PREFIX = "<!-- tda:segment ";
const COMMENT_SUFFIX = " -->";
const SEGMENT_END = "<!-- /tda:segment -->";
const SPEAKER_PREFIX = "Speaker: ";
const MAX_MARKDOWN_BYTES = 32 * 1024 * 1024;
const MAX_SEGMENTS = 100_000;
const SEGMENT_ID = /^[A-Za-z0-9_-]{1,256}$/u;
const SESSION_ID = /^[A-Za-z0-9_-]{1,160}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

export type TranscriptMarkdownSegmentV1 = Readonly<{
	id: string;
	trackNumber: number;
	startMs: number;
	endMs: number;
	absoluteStart: string | null;
	absoluteEnd: string | null;
	speaker: string;
	text: string;
}>;

export type TranscriptMarkdownDocumentV1 = Readonly<{
	sessionId: string;
	segments: readonly TranscriptMarkdownSegmentV1[];
}>;

export type TranscriptMarkdownImportV1 =
	| Readonly<{
			ok: true;
			segments: readonly TranscriptMarkdownSegmentV1[];
			changedSegmentIds: readonly string[];
			structureSha256: string;
	  }>
	| Readonly<{
			ok: false;
			reason:
				| "too_large"
				| "invalid_header"
				| "invalid_structure"
				| "structure_mismatch"
				| "invalid_editorial";
	  }>;

type StructuralSegment = Readonly<{
	id: string;
	trackNumber: number;
	startMs: number;
	endMs: number;
	absoluteStart: string | null;
	absoluteEnd: string | null;
}>;

type Header = Readonly<{
	schema: typeof TDA_TRANSCRIPT_MARKDOWN_SCHEMA;
	sessionId: string;
	segmentCount: number;
	structureSha256: string;
}>;

function utf8Bytes(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

function exactKeys(
	value: Record<string, unknown>,
	expected: readonly string[],
): boolean {
	const keys = Object.keys(value);
	return (
		keys.length === expected.length &&
		keys.every((key) => expected.includes(key))
	);
}

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function normalizeIso(value: string | null): string | null {
	if (value === null) return null;
	if (
		value.length > 64 ||
		!Number.isFinite(Date.parse(value)) ||
		(!/[zZ]$/u.test(value) && !/[+-]\d{2}:\d{2}$/u.test(value))
	)
		throw new Error("invalid_structure");
	return value;
}

function validateSegment(
	segment: TranscriptMarkdownSegmentV1,
): TranscriptMarkdownSegmentV1 {
	if (
		!SEGMENT_ID.test(segment.id) ||
		!Number.isSafeInteger(segment.trackNumber) ||
		segment.trackNumber < 1 ||
		segment.trackNumber > 9999 ||
		!Number.isSafeInteger(segment.startMs) ||
		!Number.isSafeInteger(segment.endMs) ||
		segment.startMs < 0 ||
		segment.endMs < segment.startMs ||
		segment.endMs > 604_800_000 ||
		typeof segment.speaker !== "string" ||
		segment.speaker.length < 1 ||
		segment.speaker.length > 160 ||
		/[\r\n\u0000]/u.test(segment.speaker) ||
		typeof segment.text !== "string" ||
		segment.text.length < 1 ||
		segment.text.length > 200_000
	)
		throw new Error("invalid_editorial");
	const absoluteStart = normalizeIso(segment.absoluteStart);
	const absoluteEnd = normalizeIso(segment.absoluteEnd);
	if (
		(absoluteStart === null) !== (absoluteEnd === null) ||
		(absoluteStart !== null &&
			absoluteEnd !== null &&
			Date.parse(absoluteEnd) < Date.parse(absoluteStart))
	)
		throw new Error("invalid_structure");
	return { ...segment, absoluteStart, absoluteEnd };
}

function structural(segment: TranscriptMarkdownSegmentV1): StructuralSegment {
	return {
		id: segment.id,
		trackNumber: segment.trackNumber,
		startMs: segment.startMs,
		endMs: segment.endMs,
		absoluteStart: segment.absoluteStart,
		absoluteEnd: segment.absoluteEnd,
	};
}

async function sha256(value: string): Promise<string> {
	if (!globalThis.crypto?.subtle) throw new Error("crypto_unavailable");
	const digest = await globalThis.crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(value),
	);
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

async function structureSha256(
	sessionId: string,
	segments: readonly TranscriptMarkdownSegmentV1[],
): Promise<string> {
	return sha256(
		JSON.stringify({
			schema: TDA_TRANSCRIPT_MARKDOWN_SCHEMA,
			sessionId,
			segments: segments.map(structural),
		}),
	);
}

function elapsed(ms: number): string {
	const hours = Math.floor(ms / 3_600_000);
	const minutes = Math.floor((ms % 3_600_000) / 60_000);
	const seconds = Math.floor((ms % 60_000) / 1000);
	const millis = ms % 1000;
	return (
		String(hours).padStart(2, "0") +
		":" +
		String(minutes).padStart(2, "0") +
		":" +
		String(seconds).padStart(2, "0") +
		"." +
		String(millis).padStart(3, "0")
	);
}

function timeLine(segment: TranscriptMarkdownSegmentV1): string {
	return segment.absoluteStart
		? \`Time: \${elapsed(segment.startMs)} | \${segment.absoluteStart}\`
		: \`Time: \${elapsed(segment.startMs)}\`;
}

function marker(segment: TranscriptMarkdownSegmentV1): string {
	return (
		SEGMENT_PREFIX +
		JSON.stringify(structural(segment)) +
		COMMENT_SUFFIX
	);
}

function parseComment(
	line: string,
	prefix: string,
): Record<string, unknown> | null {
	if (!line.startsWith(prefix) || !line.endsWith(COMMENT_SUFFIX)) return null;
	const json = line.slice(prefix.length, -COMMENT_SUFFIX.length);
	try {
		return record(JSON.parse(json));
	} catch {
		return null;
	}
}

function parseStructural(
	value: Record<string, unknown>,
): StructuralSegment | null {
	if (
		!exactKeys(value, [
			"id",
			"trackNumber",
			"startMs",
			"endMs",
			"absoluteStart",
			"absoluteEnd",
		]) ||
		typeof value.id !== "string" ||
		!SEGMENT_ID.test(value.id) ||
		typeof value.trackNumber !== "number" ||
		!Number.isSafeInteger(value.trackNumber) ||
		value.trackNumber < 1 ||
		value.trackNumber > 9999 ||
		typeof value.startMs !== "number" ||
		typeof value.endMs !== "number" ||
		!Number.isSafeInteger(value.startMs) ||
		!Number.isSafeInteger(value.endMs) ||
		value.startMs < 0 ||
		value.endMs < value.startMs ||
		value.endMs > 604_800_000 ||
		!(
			value.absoluteStart === null ||
			typeof value.absoluteStart === "string"
		) ||
		!(value.absoluteEnd === null || typeof value.absoluteEnd === "string")
	)
		return null;
	try {
		const absoluteStart = normalizeIso(value.absoluteStart as string | null);
		const absoluteEnd = normalizeIso(value.absoluteEnd as string | null);
		if (
			(absoluteStart === null) !== (absoluteEnd === null) ||
			(absoluteStart !== null &&
				absoluteEnd !== null &&
				Date.parse(absoluteEnd) < Date.parse(absoluteStart))
		)
			return null;
		return {
			id: value.id,
			trackNumber: value.trackNumber,
			startMs: value.startMs,
			endMs: value.endMs,
			absoluteStart,
			absoluteEnd,
		};
	} catch {
		return null;
	}
}

function sameStructure(
	left: StructuralSegment,
	right: StructuralSegment,
): boolean {
	return (
		left.id === right.id &&
		left.trackNumber === right.trackNumber &&
		left.startMs === right.startMs &&
		left.endMs === right.endMs &&
		left.absoluteStart === right.absoluteStart &&
		left.absoluteEnd === right.absoluteEnd
	);
}

function parseHeader(line: string): Header | null {
	const value = parseComment(line, HEADER_PREFIX);
	if (
		!value ||
		!exactKeys(value, [
			"schema",
			"sessionId",
			"segmentCount",
			"structureSha256",
		]) ||
		value.schema !== TDA_TRANSCRIPT_MARKDOWN_SCHEMA ||
		typeof value.sessionId !== "string" ||
		!SESSION_ID.test(value.sessionId) ||
		typeof value.segmentCount !== "number" ||
		!Number.isSafeInteger(value.segmentCount) ||
		value.segmentCount < 1 ||
		value.segmentCount > MAX_SEGMENTS ||
		typeof value.structureSha256 !== "string" ||
		!SHA256.test(value.structureSha256)
	)
		return null;
	return {
		schema: TDA_TRANSCRIPT_MARKDOWN_SCHEMA,
		sessionId: value.sessionId,
		segmentCount: value.segmentCount,
		structureSha256: value.structureSha256,
	};
}

export async function renderTranscriptMarkdownV1(
	document: TranscriptMarkdownDocumentV1,
): Promise<string> {
	if (
		!SESSION_ID.test(document.sessionId) ||
		document.segments.length < 1 ||
		document.segments.length > MAX_SEGMENTS
	)
		throw new Error("invalid_structure");
	const segments = document.segments.map(validateSegment);
	if (new Set(segments.map((segment) => segment.id)).size !== segments.length)
		throw new Error("invalid_structure");
	const structureSha = await structureSha256(document.sessionId, segments);
	const header: Header = {
		schema: TDA_TRANSCRIPT_MARKDOWN_SCHEMA,
		sessionId: document.sessionId,
		segmentCount: segments.length,
		structureSha256: structureSha,
	};
	const blocks = segments.map(
		(segment) =>
			[
				marker(segment),
				timeLine(segment),
				SPEAKER_PREFIX + segment.speaker,
				"",
				segment.text,
				SEGMENT_END,
			].join("\n"),
	);
	const output = [
		HEADER_PREFIX + JSON.stringify(header) + COMMENT_SUFFIX,
		"",
		"# TDA Transcript",
		"",
		"Edite somente o speaker e o texto. IDs e horários são verificados na importação.",
		"",
		...blocks,
		"",
	].join("\n");
	if (utf8Bytes(output) > MAX_MARKDOWN_BYTES) throw new Error("too_large");
	return output;
}

export async function parseTranscriptMarkdownV1(
	raw: string,
	expected: TranscriptMarkdownDocumentV1,
): Promise<TranscriptMarkdownImportV1> {
	if (utf8Bytes(raw) > MAX_MARKDOWN_BYTES)
		return { ok: false, reason: "too_large" };
	if (
		!SESSION_ID.test(expected.sessionId) ||
		expected.segments.length < 1 ||
		expected.segments.length > MAX_SEGMENTS
	)
		return { ok: false, reason: "invalid_structure" };

	let baseline: TranscriptMarkdownSegmentV1[];
	try {
		baseline = expected.segments.map(validateSegment);
	} catch {
		return { ok: false, reason: "invalid_structure" };
	}
	if (new Set(baseline.map((segment) => segment.id)).size !== baseline.length)
		return { ok: false, reason: "invalid_structure" };

	const normalized = raw.replace(/\r\n?/gu, "\n");
	const lines = normalized.split("\n");
	const headerIndex = lines.findIndex((line) => line.startsWith(HEADER_PREFIX));
	if (headerIndex < 0) return { ok: false, reason: "invalid_header" };
	if (
		lines.some(
			(line, index) =>
				index !== headerIndex && line.startsWith(HEADER_PREFIX),
		)
	)
		return { ok: false, reason: "invalid_header" };
	const header = parseHeader(lines[headerIndex]);
	if (
		!header ||
		header.sessionId !== expected.sessionId ||
		header.segmentCount !== baseline.length
	)
		return { ok: false, reason: "invalid_header" };

	const expectedSha = await structureSha256(expected.sessionId, baseline);
	if (header.structureSha256 !== expectedSha)
		return { ok: false, reason: "structure_mismatch" };

	const imported: TranscriptMarkdownSegmentV1[] = [];
	let index = headerIndex + 1;
	while (index < lines.length) {
		if (!lines[index].startsWith(SEGMENT_PREFIX)) {
			index += 1;
			continue;
		}
		const rawMarker = parseComment(lines[index], SEGMENT_PREFIX);
		const immutable = rawMarker ? parseStructural(rawMarker) : null;
		if (!immutable) return { ok: false, reason: "invalid_structure" };
		const expectedSegment = baseline[imported.length];
		if (!expectedSegment || !sameStructure(immutable, structural(expectedSegment)))
			return { ok: false, reason: "structure_mismatch" };

		const expectedTime = timeLine(expectedSegment);
		if (lines[index + 1] !== expectedTime)
			return { ok: false, reason: "structure_mismatch" };
		const speakerLine = lines[index + 2];
		if (
			typeof speakerLine !== "string" ||
			!speakerLine.startsWith(SPEAKER_PREFIX)
		)
			return { ok: false, reason: "invalid_editorial" };
		const speaker = speakerLine.slice(SPEAKER_PREFIX.length);
		if (
			speaker.length < 1 ||
			speaker.length > 160 ||
			/[\r\n\u0000]/u.test(speaker)
		)
			return { ok: false, reason: "invalid_editorial" };
		if (lines[index + 3] !== "")
			return { ok: false, reason: "invalid_editorial" };

		const textStart = index + 4;
		const endIndex = lines.indexOf(SEGMENT_END, textStart);
		if (endIndex < 0) return { ok: false, reason: "invalid_structure" };
		for (let cursor = textStart; cursor < endIndex; cursor += 1) {
			if (
				lines[cursor].startsWith(SEGMENT_PREFIX) ||
				lines[cursor].startsWith(HEADER_PREFIX)
			)
				return { ok: false, reason: "invalid_structure" };
		}
		const text = lines.slice(textStart, endIndex).join("\n");
		if (text.length < 1 || text.length > 200_000)
			return { ok: false, reason: "invalid_editorial" };

		imported.push({
			...expectedSegment,
			speaker,
			text,
		});
		index = endIndex + 1;
	}

	if (imported.length !== baseline.length)
		return { ok: false, reason: "structure_mismatch" };
	const importedSha = await structureSha256(expected.sessionId, imported);
	if (importedSha !== expectedSha || importedSha !== header.structureSha256)
		return { ok: false, reason: "structure_mismatch" };

	const changedSegmentIds = imported
		.filter(
			(segment, position) =>
				segment.speaker !== baseline[position]?.speaker ||
				segment.text !== baseline[position]?.text,
		)
		.map((segment) => segment.id);
	return {
		ok: true,
		segments: imported,
		changedSegmentIds,
		structureSha256: importedSha,
	};
}
