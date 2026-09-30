import { describe, expect, it } from "vitest";
import type { TranscriptReaderSegment, TranscriptReaderSnapshot } from "./reader-contract";
import {
	parseTranscriptRoundTripMarkdown,
	renderTranscriptRoundTripMarkdown,
	transcriptStructureSha256,
} from "./markdown-roundtrip";

const identity = {
	campaignSlug: "yuhara-main",
	sourceSessionId: "sessao-19",
	baseRevisionId: "11111111-1111-4111-8111-111111111111",
	baseRevisionNumber: 7,
} as const;

function segment(index: number): TranscriptReaderSegment {
	return {
		id: `r-1-seg-${index}`,
		sourceSegmentId: `seg-${index}`,
		trackNumber: index % 4 + 1,
		startMs: index * 1250,
		endMs: index * 1250 + 900,
		speaker: index % 2 ? "Alya" : "Renan",
		text: `Fala sintética ${index} 🌲`,
	};
}

function snapshot(count = 3): TranscriptReaderSnapshot {
	return {
		source: "current_revision",
		revisionId: identity.baseRevisionId,
		revisionNumber: identity.baseRevisionNumber,
		segments: Array.from({ length: count }, (_, index) => segment(index)),
	};
}

async function render(count = 3) {
	return renderTranscriptRoundTripMarkdown({
		title: "Sessão sintética",
		sessionDate: "2026-09-29",
		arc: "Raízes",
		identity,
		snapshot: snapshot(count),
	});
}

describe("TDA Transcript Markdown v1", () => {
	it("round-trips without creating edits when only presentation whitespace is untouched", async () => {
		const base = snapshot();
		const markdown = await render();
		expect(markdown).toContain("tda_transcript: tda_transcript_markdown_v1");
		expect(markdown).toContain("<!-- tda:segment track=1 id=seg-0 start_ms=0 end_ms=900 -->");
		const parsed = await parseTranscriptRoundTripMarkdown({
			markdown,
			expected: identity,
			baseline: base.segments,
		});
		expect(parsed.edits).toEqual([]);
		expect(parsed.changedSegments).toBe(0);
		expect(parsed.structureSha256).toBe(
			await transcriptStructureSha256(base.segments),
		);
	});

	it("allows only speaker and text edits while preserving marker identity and timing", async () => {
		const base = snapshot();
		const markdown = (await render())
			.replace("Speaker: Renan", "Speaker: Renan Gomes")
			.replace("Fala sintética 0 🌲", "Texto corrigido\nem duas linhas.");
		const parsed = await parseTranscriptRoundTripMarkdown({
			markdown,
			expected: identity,
			baseline: base.segments,
		});
		expect(parsed.changedSegments).toBe(1);
		expect(parsed.edits).toEqual([
			{
				trackNumber: 1,
				segmentId: "seg-0",
				speaker: "Renan Gomes",
				text: "Texto corrigido\nem duas linhas.",
			},
		]);
	});

	it("fails closed for stale revision identity, structural hash tamper, timing edits, removal and reorder", async () => {
		const base = snapshot();
		const markdown = await render();
		await expect(
			parseTranscriptRoundTripMarkdown({
				markdown,
				expected: { ...identity, baseRevisionNumber: 8 },
				baseline: base.segments,
			}),
		).rejects.toThrow("TRANSCRIPT_MARKDOWN_STALE_BASE");

		await expect(
			parseTranscriptRoundTripMarkdown({
				markdown: markdown.replace(
					/structure_sha256: [0-9a-f]{64}/u,
					`structure_sha256: ${"f".repeat(64)}`,
				),
				expected: identity,
				baseline: base.segments,
			}),
		).rejects.toThrow("TRANSCRIPT_MARKDOWN_STRUCTURE_HASH_MISMATCH");

		await expect(
			parseTranscriptRoundTripMarkdown({
				markdown: markdown.replace("start_ms=0", "start_ms=1"),
				expected: identity,
				baseline: base.segments,
			}),
		).rejects.toThrow("TRANSCRIPT_MARKDOWN_STRUCTURE_CHANGED");

		const firstBlock = markdown.indexOf("<!-- tda:segment");
		const secondBlock = markdown.indexOf("<!-- tda:segment", firstBlock + 1);
		const thirdBlock = markdown.indexOf("<!-- tda:segment", secondBlock + 1);
		const header = markdown.slice(0, firstBlock);
		const first = markdown.slice(firstBlock, secondBlock);
		const second = markdown.slice(secondBlock, thirdBlock);
		const third = markdown.slice(thirdBlock);
		await expect(
			parseTranscriptRoundTripMarkdown({
				markdown: header + second + first + third,
				expected: identity,
				baseline: base.segments,
			}),
		).rejects.toThrow("TRANSCRIPT_MARKDOWN_STRUCTURE_CHANGED");
		await expect(
			parseTranscriptRoundTripMarkdown({
				markdown: header + first + third,
				expected: identity,
				baseline: base.segments,
			}),
		).rejects.toThrow("TRANSCRIPT_MARKDOWN_STRUCTURE_CHANGED");
	});

	it("rejects duplicate/forged markers and reserved marker injection in editable text", async () => {
		const base = snapshot();
		const markdown = await render();
		const marker =
			"<!-- tda:segment track=1 id=seg-0 start_ms=0 end_ms=900 -->";
		await expect(
			parseTranscriptRoundTripMarkdown({
				markdown: markdown.replace(marker, `${marker}\n${marker}`),
				expected: identity,
				baseline: base.segments,
			}),
		).rejects.toThrow();

		await expect(
			renderTranscriptRoundTripMarkdown({
				title: "Teste",
				sessionDate: null,
				arc: null,
				identity,
				snapshot: {
					...base,
					segments: [
						{ ...base.segments[0], text: "forjado <!-- tda:segment track=1 id=x start_ms=0 end_ms=1 -->" },
					],
				},
			}),
		).rejects.toThrow("TRANSCRIPT_MARKDOWN_RESERVED_MARKER_IN_TEXT");
	});

	it("handles 7,500 utterances deterministically without changing the structural digest", async () => {
		const base = snapshot(7_500);
		const markdown = await renderTranscriptRoundTripMarkdown({
			title: "Sessão grande sintética",
			sessionDate: null,
			arc: null,
			identity,
			snapshot: base,
		});
		const parsed = await parseTranscriptRoundTripMarkdown({
			markdown,
			expected: identity,
			baseline: base.segments,
		});
		expect(parsed.changedSegments).toBe(0);
		expect(parsed.edits).toHaveLength(0);
		expect(parsed.structureSha256).toBe(
			await transcriptStructureSha256(base.segments),
		);
	});
});
