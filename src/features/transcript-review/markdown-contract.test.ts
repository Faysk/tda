import { describe, expect, it } from "vitest";
import {
	decodeTranscriptMarkdownBytes,
	parseTranscriptMarkdownV1,
	renderTranscriptMarkdownV1,
	TranscriptMarkdownError,
	type TranscriptMarkdownBase,
	type TranscriptMarkdownSegment,
} from "./markdown-contract";

const base: TranscriptMarkdownBase = {
	sessionId: "sessao-42",
	baseKind: "local_run",
	baseId: "craig-" + "a".repeat(64) + "/run-1",
	baseRevision: 3,
	baseSha256: "b".repeat(64),
};

const segments: readonly TranscriptMarkdownSegment[] = [
	{
		id: "track:1:segment:seg-a",
		startMs: 44_000,
		endMs: 48_900,
		speaker: "faysk",
		text: "Você tinha descrito como era esse gato?",
	},
	{
		id: "track:2:segment:seg-b",
		startMs: 49_000,
		endMs: 53_500,
		speaker: "Renan",
		text: "Era um gato normal de rua. 🌲",
	},
];

async function exported() {
	return renderTranscriptMarkdownV1({
		base,
		segments,
		title: "Sessão sintética",
		exportedAt: "2026-09-30T00:00:00.000Z",
	});
}

async function expectCode(value: Promise<unknown>, code: TranscriptMarkdownError["code"]) {
	await expect(value).rejects.toMatchObject({ code });
}

describe("TDA transcript Markdown v1", () => {
	it("round-trips with zero edits without creating a diff", async () => {
		const markdown = await exported();
		const result = await parseTranscriptMarkdownV1({
			text: markdown,
			expectedBase: base,
			expectedSegments: segments,
		});
		expect(result.changedSegments).toBe(0);
		expect(result.unchangedSegments).toBe(2);
		expect(result.structureSha256).toMatch(/^[0-9a-f]{64}$/u);
		expect(markdown).toContain("tda_transcript_schema: 1");
		expect(markdown).toContain("<!-- tda:segment id=");
	});

	it("accepts speaker and text corrections while preserving structure", async () => {
		const markdown = (await exported())
			.replace("**faysk**", "**Faysk**")
			.replace(
				"Você tinha descrito como era esse gato?",
				"Você tinha descrito como era esse gato mesmo?",
			)
			.replace("Era um gato normal de rua. 🌲", "Era um gato normal de rua. 🌲\r\nCom acento: coração.");
		const result = await parseTranscriptMarkdownV1({
			text: markdown.replace(/\n/gu, "\r\n"),
			expectedBase: base,
			expectedSegments: segments,
		});
		expect(result.changedSegments).toBe(2);
		expect(result.speakerChanges).toBe(1);
		expect(result.textChanges).toBe(2);
		expect(result.segments[0]).toMatchObject({
			id: segments[0].id,
			startMs: 44_000,
			endMs: 48_900,
			speaker: "Faysk",
		});
		expect(result.segments[1].text).toContain("coração");
	});

	it("treats Markdown and HTML as inert editable text", async () => {
		const custom = [
			segments[0],
			{
				...segments[1],
				text: "Texto com **markdown**, <script>alert(1)</script>, `code`, <!-- comentário --> e emoji 🦆.",
			},
		];
		const markdown = await renderTranscriptMarkdownV1({
			base,
			segments: custom,
			exportedAt: "2026-09-30T00:00:00.000Z",
		});
		const result = await parseTranscriptMarkdownV1({
			text: markdown,
			expectedBase: base,
			expectedSegments: custom,
		});
		expect(result.changedSegments).toBe(0);
		expect(result.segments[1].text).toContain("<script>alert(1)</script>");
	});

	it("fails closed on wrong base and structural tampering", async () => {
		const markdown = await exported();
		await expectCode(
			parseTranscriptMarkdownV1({
				text: markdown.replace('"sessao-42"', '"sessao-99"'),
				expectedBase: base,
				expectedSegments: segments,
			}),
			"BASE_MISMATCH",
		);
		await expectCode(
			parseTranscriptMarkdownV1({
				text: markdown.replace('start_ms="44000"', 'start_ms="44001"'),
				expectedBase: base,
				expectedSegments: segments,
			}),
			"TIMING_CHANGED",
		);
		await expectCode(
			parseTranscriptMarkdownV1({
				text: markdown.replace("[00:00:44.000]", "[00:00:45.000]"),
				expectedBase: base,
				expectedSegments: segments,
			}),
			"VISIBLE_TIMESTAMP_CHANGED",
		);
		await expectCode(
			parseTranscriptMarkdownV1({
				text: markdown.replace(/<!-- tda:segment id="track:2:segment:seg-b"[\s\S]*$/u, ""),
				expectedBase: base,
				expectedSegments: segments,
			}),
			"MARKER_MISSING",
		);
		await expectCode(
			parseTranscriptMarkdownV1({
				text: markdown.replace(
					'"track:1:segment:seg-a"',
					'"track:9:segment:unknown"',
				),
				expectedBase: base,
				expectedSegments: segments,
			}),
			"MARKER_UNKNOWN",
		);
		await expectCode(
			parseTranscriptMarkdownV1({
				text: markdown.replace(
					/structure_sha256: "[0-9a-f]{64}"/u,
					'structure_sha256: "' + "0".repeat(64) + '"',
				),
				expectedBase: base,
				expectedSegments: segments,
			}),
			"STRUCTURE_HASH_MISMATCH",
		);
	});

	it("rejects duplicate markers and reordered blocks", async () => {
		const markdown = await exported();
		const firstMarker = '<!-- tda:segment id="track:1:segment:seg-a" start_ms="44000" end_ms="48900" -->';
		const secondMarker = '<!-- tda:segment id="track:2:segment:seg-b" start_ms="49000" end_ms="53500" -->';
		await expectCode(
			parseTranscriptMarkdownV1({
				text: markdown.replace(secondMarker, firstMarker),
				expectedBase: base,
				expectedSegments: segments,
			}),
			"MARKER_DUPLICATE",
		);
		await expectCode(
			parseTranscriptMarkdownV1({
				text: markdown
					.replace(firstMarker, "<!-- swap-a -->")
					.replace(secondMarker, firstMarker)
					.replace("<!-- swap-a -->", secondMarker),
				expectedBase: base,
				expectedSegments: segments,
			}),
			"SEGMENT_REORDERED",
		);
	});

	it("handles a synthetic 7,500-segment transcript in linear contract space", async () => {
		const many = Array.from({ length: 7_500 }, (_, index) => ({
			id: "track:1:segment:s" + index,
			startMs: index * 1_000,
			endMs: index * 1_000 + 900,
			speaker: index % 2 ? "Alya" : "Noah",
			text: "Fala sintética " + index + " — coração 🦆",
		}));
		const markdown = await renderTranscriptMarkdownV1({
			base,
			segments: many,
			exportedAt: "2026-09-30T00:00:00.000Z",
		});
		const result = await parseTranscriptMarkdownV1({
			text: markdown,
			expectedBase: base,
			expectedSegments: many,
		});
		expect(result.changedSegments).toBe(0);
		expect(result.segments).toHaveLength(7_500);
	});

	it("round-trips trusted wall-clock metadata and fails closed on clock tampering", async () => {
		const trusted: readonly TranscriptMarkdownSegment[] = [
			{
				...segments[0],
				absoluteTime: {
					startIso: "2026-09-12T23:59:59+01:00",
					endIso: "2026-09-13T00:00:03.900+01:00",
					source: "craig-source-a",
				},
			},
			segments[1],
		];
		const markdown = await renderTranscriptMarkdownV1({
			base,
			segments: trusted,
			title: "Sessão virando a meia-noite",
			exportedAt: "2026-09-30T00:00:00.000Z",
		});
		expect(markdown).toContain("[00:00:44.000 | 23:59:59] **faysk**");
		expect(markdown).toContain('absolute_start="2026-09-12T23:59:59+01:00"');
		expect(markdown).toContain('absolute_end="2026-09-13T00:00:03.900+01:00"');
		expect(markdown).toContain('absolute_source="craig-source-a"');
		expect(markdown).toContain("[00:00:49.000] **Renan**");

		const parsed = await parseTranscriptMarkdownV1({
			text: markdown,
			expectedBase: base,
			expectedSegments: trusted,
		});
		expect(parsed.changedSegments).toBe(0);
		expect(parsed.segments[0]?.absoluteTime).toEqual(trusted[0].absoluteTime);
		expect(parsed.segments[1]?.absoluteTime).toBeUndefined();

		await expectCode(
			parseTranscriptMarkdownV1({
				text: markdown.replace(
					"[00:00:44.000 | 23:59:59]",
					"[00:00:44.000 | 00:00:00]",
				),
				expectedBase: base,
				expectedSegments: trusted,
			}),
			"VISIBLE_TIMESTAMP_CHANGED",
		);
		await expectCode(
			parseTranscriptMarkdownV1({
				text: markdown.replace(
					'absolute_start="2026-09-12T23:59:59+01:00"',
					'absolute_start="2026-09-12T23:59:58+01:00"',
				),
				expectedBase: base,
				expectedSegments: trusted,
			}),
			"TIMING_CHANGED",
		);
	});

	it("keeps elapsed-only Markdown byte shape when wall clock is unavailable", async () => {
		const markdown = await exported();
		expect(markdown).toContain("[00:00:44.000] **faysk**");
		expect(markdown).not.toContain("absolute_start=");
		expect(markdown).not.toContain(" | ");
	});

	it("enforces strict UTF-8 decoding", () => {
		expect(() => decodeTranscriptMarkdownBytes(new Uint8Array([0xc3, 0x28]))).toThrow(
			expect.objectContaining({ code: "UTF8_INVALID" }),
		);
	});
});
