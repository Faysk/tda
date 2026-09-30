import { isReviewStringV1 } from "@/features/transcript-review/text-contract";
import type { TranscriptReaderSegment, TranscriptReaderSnapshot } from "./reader-contract";

export const TRANSCRIPT_MARKDOWN_SCHEMA = "tda_transcript_markdown_v1";
export const TRANSCRIPT_MARKDOWN_MAX_BYTES = 16 * 1024 * 1024;
export const TRANSCRIPT_MARKDOWN_MAX_SEGMENTS = 100_000;

const MARKER =
	/^<!-- tda:segment track=(\d+) id=([^ ]+) start_ms=(\d+) end_ms=(\d+) -->$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type TranscriptMarkdownIdentity = Readonly<{
	campaignSlug: string;
	sourceSessionId: string;
	baseRevisionId: string;
	baseRevisionNumber: number;
}>;

export type TranscriptMarkdownImport = Readonly<{
	identity: TranscriptMarkdownIdentity;
	structureSha256: string;
	edits: readonly Readonly<{
		trackNumber: number;
		segmentId: string;
		speaker: string;
		text: string;
	}>[];
	changedSegments: number;
}>;

function utf8Bytes(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

function scalarLength(value: string): number {
	return [...value].length;
}

function validFrontmatterText(value: string, maximum: number): boolean {
	return (
		value.length > 0 &&
		scalarLength(value) <= maximum &&
		!value.includes("\u0000") &&
		!value.includes("\n") &&
		!value.includes("\r")
	);
}

function stableSegmentId(segment: TranscriptReaderSegment): string {
	const value = segment.sourceSegmentId;
	if (
		typeof value !== "string" ||
		!value.trim() ||
		scalarLength(value) > 256 ||
		value.includes("\u0000")
	)
		throw new Error("TRANSCRIPT_MARKDOWN_SEGMENT_ID_REQUIRED");
	return value;
}

function structureRows(segments: readonly TranscriptReaderSegment[]) {
	return segments.map((segment) => ({
		track: segment.trackNumber,
		id: stableSegmentId(segment),
		start_ms: segment.startMs,
		end_ms: segment.endMs,
	}));
}

async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

export async function transcriptStructureSha256(
	segments: readonly TranscriptReaderSegment[],
): Promise<string> {
	if (segments.length > TRANSCRIPT_MARKDOWN_MAX_SEGMENTS)
		throw new Error("TRANSCRIPT_MARKDOWN_SEGMENT_LIMIT");
	const seen = new Set<string>();
	const rows = structureRows(segments);
	for (const row of rows) {
		if (
			!Number.isSafeInteger(row.track) ||
			row.track < 1 ||
			!Number.isSafeInteger(row.start_ms) ||
			!Number.isSafeInteger(row.end_ms) ||
			row.start_ms < 0 ||
			row.end_ms < row.start_ms
		)
			throw new Error("TRANSCRIPT_MARKDOWN_STRUCTURE_INVALID");
		const key = \`\${row.track}\\0\${row.id}\`;
		if (seen.has(key)) throw new Error("TRANSCRIPT_MARKDOWN_DUPLICATE_SEGMENT");
		seen.add(key);
	}
	return sha256Hex(JSON.stringify(rows));
}

function marker(segment: TranscriptReaderSegment): string {
	return \`<!-- tda:segment track=\${segment.trackNumber} id=\${encodeURIComponent(
		stableSegmentId(segment),
	)} start_ms=\${segment.startMs} end_ms=\${segment.endMs} -->\`;
}

function cleanEditableText(value: string, field: "speaker" | "text"): string {
	if (!isReviewStringV1(value, field))
		throw new Error(\`TRANSCRIPT_MARKDOWN_\${field.toUpperCase()}_INVALID\`);
	if (value.includes("<!-- tda:segment "))
		throw new Error("TRANSCRIPT_MARKDOWN_RESERVED_MARKER_IN_TEXT");
	return value.replace(/\r\n?/gu, "\n");
}

export async function renderTranscriptRoundTripMarkdown(input: {
	title: string;
	sessionDate: string | null;
	arc: string | null;
	identity: TranscriptMarkdownIdentity;
	snapshot: TranscriptReaderSnapshot;
}): Promise<string> {
	if (
		input.snapshot.source !== "current_revision" ||
		input.snapshot.revisionId !== input.identity.baseRevisionId ||
		input.snapshot.revisionNumber !== input.identity.baseRevisionNumber ||
		!UUID.test(input.identity.baseRevisionId) ||
		!Number.isSafeInteger(input.identity.baseRevisionNumber) ||
		input.identity.baseRevisionNumber < 1 ||
		!validFrontmatterText(input.identity.campaignSlug, 128) ||
		!validFrontmatterText(input.identity.sourceSessionId, 220)
	)
		throw new Error("TRANSCRIPT_MARKDOWN_IDENTITY_INVALID");

	const structureSha256 = await transcriptStructureSha256(input.snapshot.segments);
	const lines = [
		"---",
		\`tda_transcript: \${TRANSCRIPT_MARKDOWN_SCHEMA}\`,
		\`campaign: \${input.identity.campaignSlug}\`,
		\`source_session_id: \${input.identity.sourceSessionId}\`,
		\`base_revision_id: \${input.identity.baseRevisionId}\`,
		\`base_revision_number: \${input.identity.baseRevisionNumber}\`,
		\`structure_sha256: \${structureSha256}\`,
		"---",
		"",
		\`# Transcrição — \${input.title.replace(/\r\n?/gu, " ").trim()}\`,
		"",
		\`Sessão: \${input.sessionDate ?? "data não informada"}\`,
		\`Arco: \${input.arc ?? "não informado"}\`,
		"",
		"Edite somente o speaker e o texto das falas. Não altere nem remova linhas tda:segment.",
		"",
		"## Transcrição",
		"",
	];
	for (const segment of input.snapshot.segments) {
		const speaker = cleanEditableText(segment.speaker, "speaker");
		const text = cleanEditableText(segment.text, "text");
		lines.push(marker(segment), \`Speaker: \${speaker}\`, text, "");
	}
	const body = \`\${lines.join("\n").trimEnd()}\n\`;
	if (utf8Bytes(body) > TRANSCRIPT_MARKDOWN_MAX_BYTES)
		throw new Error("TRANSCRIPT_MARKDOWN_TOO_LARGE");
	return body;
}

function parseFrontmatter(lines: readonly string[]) {
	if (lines[0] !== "---") throw new Error("TRANSCRIPT_MARKDOWN_FRONTMATTER_REQUIRED");
	const end = lines.indexOf("---", 1);
	if (end < 2 || end > 16) throw new Error("TRANSCRIPT_MARKDOWN_FRONTMATTER_INVALID");
	const values = new Map<string, string>();
	for (const line of lines.slice(1, end)) {
		const split = line.indexOf(":");
		if (split < 1) throw new Error("TRANSCRIPT_MARKDOWN_FRONTMATTER_INVALID");
		const key = line.slice(0, split).trim();
		const value = line.slice(split + 1).trim();
		if (!key || !value || values.has(key))
			throw new Error("TRANSCRIPT_MARKDOWN_FRONTMATTER_INVALID");
		values.set(key, value);
	}
	const allowed = new Set([
		"tda_transcript",
		"campaign",
		"source_session_id",
		"base_revision_id",
		"base_revision_number",
		"structure_sha256",
	]);
	for (const key of values.keys()) {
		if (!allowed.has(key)) throw new Error("TRANSCRIPT_MARKDOWN_FRONTMATTER_UNKNOWN");
	}
	if (values.get("tda_transcript") !== TRANSCRIPT_MARKDOWN_SCHEMA)
		throw new Error("TRANSCRIPT_MARKDOWN_VERSION_UNSUPPORTED");
	const baseRevisionNumber = Number(values.get("base_revision_number"));
	const identity: TranscriptMarkdownIdentity = {
		campaignSlug: values.get("campaign") ?? "",
		sourceSessionId: values.get("source_session_id") ?? "",
		baseRevisionId: values.get("base_revision_id") ?? "",
		baseRevisionNumber,
	};
	const structureSha256 = values.get("structure_sha256") ?? "";
	if (
		!validFrontmatterText(identity.campaignSlug, 128) ||
		!validFrontmatterText(identity.sourceSessionId, 220) ||
		!UUID.test(identity.baseRevisionId) ||
		!Number.isSafeInteger(baseRevisionNumber) ||
		baseRevisionNumber < 1 ||
		!SHA256.test(structureSha256)
	)
		throw new Error("TRANSCRIPT_MARKDOWN_FRONTMATTER_INVALID");
	return { end, identity, structureSha256 };
}

function sameIdentity(
	actual: TranscriptMarkdownIdentity,
	expected: TranscriptMarkdownIdentity,
): boolean {
	return (
		actual.campaignSlug === expected.campaignSlug &&
		actual.sourceSessionId === expected.sourceSessionId &&
		actual.baseRevisionId === expected.baseRevisionId &&
		actual.baseRevisionNumber === expected.baseRevisionNumber
	);
}

export async function parseTranscriptRoundTripMarkdown(input: {
	markdown: string;
	expected: TranscriptMarkdownIdentity;
	baseline: readonly TranscriptReaderSegment[];
}): Promise<TranscriptMarkdownImport> {
	if (
		typeof input.markdown !== "string" ||
		utf8Bytes(input.markdown) > TRANSCRIPT_MARKDOWN_MAX_BYTES
	)
		throw new Error("TRANSCRIPT_MARKDOWN_TOO_LARGE");
	const normalized = input.markdown.replace(/\r\n?/gu, "\n");
	const lines = normalized.split("\n");
	const frontmatter = parseFrontmatter(lines);
	if (!sameIdentity(frontmatter.identity, input.expected))
		throw new Error("TRANSCRIPT_MARKDOWN_STALE_BASE");

	const expectedStructure = await transcriptStructureSha256(input.baseline);
	if (frontmatter.structureSha256 !== expectedStructure)
		throw new Error("TRANSCRIPT_MARKDOWN_STRUCTURE_HASH_MISMATCH");

	const baselineByKey = new Map(
		input.baseline.map((segment) => [
			\`\${segment.trackNumber}\\0\${stableSegmentId(segment)}\`,
			segment,
		]),
	);
	const parsed: Array<{
		trackNumber: number;
		segmentId: string;
		startMs: number;
		endMs: number;
		speaker: string;
		text: string;
	}> = [];
	let index = frontmatter.end + 1;
	while (index < lines.length) {
		const match = MARKER.exec(lines[index]);
		if (!match) {
			index += 1;
			continue;
		}
		if (parsed.length >= TRANSCRIPT_MARKDOWN_MAX_SEGMENTS)
			throw new Error("TRANSCRIPT_MARKDOWN_SEGMENT_LIMIT");
		const trackNumber = Number(match[1]);
		const startMs = Number(match[3]);
		const endMs = Number(match[4]);
		let segmentId: string;
		try {
			segmentId = decodeURIComponent(match[2]);
		} catch {
			throw new Error("TRANSCRIPT_MARKDOWN_MARKER_INVALID");
		}
		if (
			!Number.isSafeInteger(trackNumber) ||
			trackNumber < 1 ||
			!Number.isSafeInteger(startMs) ||
			!Number.isSafeInteger(endMs) ||
			startMs < 0 ||
			endMs < startMs
		)
			throw new Error("TRANSCRIPT_MARKDOWN_MARKER_INVALID");
		const speakerLine = lines[index + 1];
		if (typeof speakerLine !== "string" || !speakerLine.startsWith("Speaker: "))
			throw new Error("TRANSCRIPT_MARKDOWN_SPEAKER_REQUIRED");
		const speaker = speakerLine.slice("Speaker: ".length);
		index += 2;
		const textLines: string[] = [];
		while (index < lines.length && !MARKER.test(lines[index])) {
			textLines.push(lines[index]);
			index += 1;
		}
		while (textLines.length && textLines[textLines.length - 1] === "") textLines.pop();
		const text = textLines.join("\n");
		if (!isReviewStringV1(speaker, "speaker") || !isReviewStringV1(text, "text"))
			throw new Error("TRANSCRIPT_MARKDOWN_EDIT_INVALID");
		parsed.push({ trackNumber, segmentId, startMs, endMs, speaker, text });
	}

	if (parsed.length !== input.baseline.length)
		throw new Error("TRANSCRIPT_MARKDOWN_STRUCTURE_CHANGED");
	const seen = new Set<string>();
	const edits: Array<{
		trackNumber: number;
		segmentId: string;
		speaker: string;
		text: string;
	}> = [];
	let changedSegments = 0;
	for (let position = 0; position < parsed.length; position += 1) {
		const row = parsed[position];
		const key = \`\${row.trackNumber}\\0\${row.segmentId}\`;
		if (seen.has(key)) throw new Error("TRANSCRIPT_MARKDOWN_DUPLICATE_SEGMENT");
		seen.add(key);
		const base = baselineByKey.get(key);
		if (
			!base ||
			base !== input.baseline[position] ||
			base.startMs !== row.startMs ||
			base.endMs !== row.endMs
		)
			throw new Error("TRANSCRIPT_MARKDOWN_STRUCTURE_CHANGED");
		if (base.speaker !== row.speaker || base.text !== row.text) {
			changedSegments += 1;
			edits.push({
				trackNumber: row.trackNumber,
				segmentId: row.segmentId,
				speaker: row.speaker,
				text: row.text,
			});
		}
	}

	return {
		identity: frontmatter.identity,
		structureSha256: frontmatter.structureSha256,
		edits,
		changedSegments,
	};
}
