import { describe, expect, it } from "vitest";
import {
	findTranscriptJumpIndex,
	formatTranscriptTimestamp,
	normalizeRevisionSegments,
	parseTranscriptTimestamp,
	renderTranscriptMarkdown,
	sanitizeTranscriptFilenamePart,
	transcriptMarkdownFilename,
} from "./reader-contract";

describe("transcript reader contract", () => {
	it("orders globally, keeps overlaps and deterministic ties", () => {
		const segments = normalizeRevisionSegments([
			{ track_number: 2, segment_id: "b", start: 3.21, end: 8, text: "B", speaker: "Noah", reviewed: true },
			{ track_number: 1, segment_id: "z", start: 3.21, end: 7, text: "Z", speaker: "Alya", reviewed: true },
			{ track_number: 1, segment_id: "a", start: 3.21, end: 7, text: "A", speaker: "Screaky", reviewed: true },
		]);
		expect(segments.map((segment) => segment.id)).toEqual(["r-1-a", "r-1-z", "r-2-b"]);
		expect(segments).toHaveLength(3);
	});

	it("reads Session Assembly revision segments through the canonical reader identity", () => {
		const assemblySegmentId = "a".repeat(64);
		const [segment] = normalizeRevisionSegments([
			{
				assembly_segment_id: assemblySegmentId,
				segment_id: assemblySegmentId,
				part_id: "b".repeat(32),
				source_id: `craig-${"c".repeat(64)}`,
				run_id: "run-assembly-a",
				source_segment_id: "source-1",
				track_number: 3,
				start: 12.5,
				end: 14,
				text: "Trecho montado",
				speaker: "Alya",
				reviewed: true,
			},
		]);
		expect(segment).toMatchObject({
			id: `r-3-${assemblySegmentId}`,
			sourceSegmentId: assemblySegmentId,
			trackNumber: 3,
			startMs: 12_500,
			endMs: 14_000,
			text: "Trecho montado",
		});
	});

	it("supports timestamps beyond one hour with millisecond precision", () => {
		expect(formatTranscriptTimestamp(5_530_842)).toBe("01:32:10.842");
		expect(parseTranscriptTimestamp("01:32:10.842")).toBe(5_530_842);
		expect(parseTranscriptTimestamp("32:10")).toBe(1_930_000);
		expect(parseTranscriptTimestamp("nope")).toBeNull();
	});

	it("jumps to the first segment at or after the requested timestamp", () => {
		const segments = [
			{ id: "a", trackNumber: 1, startMs: 1000, endMs: 2000, speaker: "A", text: "x" },
			{ id: "b", trackNumber: 1, startMs: 5000, endMs: 6000, speaker: "B", text: "y" },
		];
		expect(findTranscriptJumpIndex(segments, 3000)).toBe(1);
		expect(findTranscriptJumpIndex(segments, 7000)).toBe(1);
		expect(findTranscriptJumpIndex([], 0)).toBe(-1);
	});

	it("preserves unicode in versioned markdown while sanitizing filesystem names", async () => {
		const snapshot = {
			source: "current_revision" as const,
			revisionId: "11111111-1111-4111-8111-111111111111",
			revisionNumber: 7,
			segments: [{ id: "x", trackNumber: 1, startMs: 3210, endMs: 4000, speaker: "Álya", text: "Coração 🌲" }],
		};
		expect(await renderTranscriptMarkdown({
			title: "Entre Canções & Raízes",
			sessionDate: "2026-08-19",
			arc: "Raízes",
			sourceSessionId: "sessao-19",
			snapshot,
		})).toContain("tda_transcript_schema: 1");
		expect(sanitizeTranscriptFilenamePart("Canções / Raízes:*?")).toBe("cancoes-raizes");
		expect(transcriptMarkdownFilename("2026-08-19T20:00:00Z", "Entre Canções", 7)).toBe(
			"2026-08-19-entre-cancoes-transcricao-r7.md",
		);
	});

	it("rejects duplicate revision segment identities instead of dropping a tie", () => {
		expect(() =>
			normalizeRevisionSegments([
				{ track_number: 1, segment_id: "same", start: 1, end: 2, text: "A", speaker: "A" },
				{ track_number: 1, segment_id: "same", start: 1, end: 2, text: "B", speaker: "B" },
			]),
		).toThrow(/duplicate/u);
	});
	it("preserves trusted wall-clock provenance without inventing it for unavailable rows", () => {
		const segments = normalizeRevisionSegments([
			{
				track_number: 1,
				segment_id: "trusted",
				start: 1,
				end: 2,
				speaker: "Alice",
				text: "Virou a meia-noite",
				absolute_time_state: "trusted_absolute",
				absolute_start: "2026-09-12T23:59:59+01:00",
				absolute_end: "2026-09-13T00:00:00+01:00",
				absolute_time_source: "craig-source-a",
			},
			{
				track_number: 2,
				segment_id: "opaque",
				start: 3,
				end: 4,
				speaker: "Bob",
				text: "Sem relógio confiável",
				absolute_time_state: "unavailable",
				absolute_start: null,
				absolute_end: null,
				absolute_time_source: null,
			},
		]);
		expect(segments[0]?.absoluteTime).toEqual({
			startIso: "2026-09-12T23:59:59+01:00",
			endIso: "2026-09-13T00:00:00+01:00",
			source: "craig-source-a",
		});
		expect(segments[1]?.absoluteTime).toBeNull();
		expect(() =>
			normalizeRevisionSegments([
				{
					track_number: 1,
					segment_id: "bad",
					start: 0,
					end: 1,
					speaker: "Alice",
					text: "Invalido",
					absolute_time_state: "trusted_absolute",
					absolute_start: "2026-09-12T23:59:59",
					absolute_end: "2026-09-13T00:00:00",
					absolute_time_source: "craig-source-a",
				},
			]),
		).toThrow(/absolute time/u);
	});

	it("exports trusted wall clock to Markdown without browser-timezone inference", async () => {
		const markdown = await renderTranscriptMarkdown({
			title: "Meia-noite",
			sessionDate: "2026-09-12",
			arc: null,
			sourceSessionId: "sessao-midnight",
			snapshot: {
				source: "current_revision",
				revisionId: "22222222-2222-4222-8222-222222222222",
				revisionNumber: 4,
				segments: [
					{
						id: "trusted",
						trackNumber: 1,
						startMs: 44_000,
						endMs: 45_000,
						absoluteTime: {
							startIso: "2026-09-12T23:59:59+01:00",
							endIso: "2026-09-13T00:00:00+01:00",
							source: "craig-source-a",
						},
						speaker: "Alya",
						text: "Última fala do dia.",
					},
				],
			},
		});
		expect(markdown).toContain("[00:00:44.000 | 23:59:59] **Alya**");
		expect(markdown).toContain('absolute_start="2026-09-12T23:59:59+01:00"');
		expect(markdown).toContain('absolute_source="craig-source-a"');
	});

});
