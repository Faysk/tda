import { describe, expect, it } from "vitest";
import {
	parseTranscriptRevisionEditResult,
	prepareTranscriptRevisionEditChanges,
} from "./revision-edit-model";

describe("prepareTranscriptRevisionEditChanges", () => {
	it("canonicalizes Unicode-safe speaker/text deltas", () => {
		expect(
			prepareTranscriptRevisionEditChanges([
				{
					segmentKey: "r-2-seg-α",
					speaker: "  Sense  ",
					text: "  Ação com ç e emoji 🦉  ",
				},
			]),
		).toEqual({
			ok: true,
			value: {
				changes: [
					{
						segmentKey: "r-2-seg-α",
						speaker: "Sense",
						text: "Ação com ç e emoji 🦉",
					},
				],
			},
		});
	});


	it("accepts a 7,500-segment delta batch without coercing content", () => {
		const input = Array.from({ length: 7_500 }, (_, index) => ({
			segmentKey: `r-1-seg-${index}`,
			speaker: index % 2 ? "Sense" : "Álya",
			text: `Linha ${index} · ação 🦉`,
		}));
		const result = prepareTranscriptRevisionEditChanges(input);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.changes).toHaveLength(7_500);
		expect(result.value.changes[7_499]).toEqual({
			segmentKey: "r-1-seg-7499",
			speaker: "Sense",
			text: "Linha 7499 · ação 🦉",
		});
	});

	it("rejects timing or other unsupported fields in this slice", () => {
		expect(
			prepareTranscriptRevisionEditChanges([
				{
					segmentKey: "r-1-a",
					speaker: "Alya",
					text: "Texto",
					startMs: 1234,
				},
			]),
		).toEqual({ ok: false, issues: ["unsupported_field"] });
	});

	it("rejects empty, duplicate and oversized edits before persistence", () => {
		const duplicate = prepareTranscriptRevisionEditChanges([
			{ segmentKey: "r-1-a", speaker: "", text: "ok" },
			{ segmentKey: "r-1-a", speaker: "A", text: "" },
		]);
		expect(duplicate).toEqual({
			ok: false,
			issues: ["speaker_required", "duplicate_segment", "text_required"],
		});

		expect(
			prepareTranscriptRevisionEditChanges([
				{
					segmentKey: "r-1-a",
					speaker: "🦉".repeat(161),
					text: "texto",
				},
			]),
		).toEqual({ ok: false, issues: ["speaker_too_long"] });
	});
});

describe("parseTranscriptRevisionEditResult", () => {
	it("accepts a confirmed immutable revision result", () => {
		expect(
			parseTranscriptRevisionEditResult([
				{
					status: "updated",
					revision_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
					revision_number: 4,
					current_revision_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
				},
			]),
		).toEqual({
			status: "updated",
			revisionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
			revisionNumber: 4,
			currentRevisionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
		});
	});

	it("preserves stale-current identity without fabricating a revision", () => {
		expect(
			parseTranscriptRevisionEditResult([
				{
					status: "stale_current",
					revision_id: null,
					revision_number: null,
					current_revision_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
				},
			]),
		).toEqual({
			status: "stale_current",
			currentRevisionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
		});
	});

	it("fails closed on malformed success rows", () => {
		expect(
			parseTranscriptRevisionEditResult([
				{ status: "updated", revision_id: null, revision_number: 4 },
			]),
		).toEqual({ status: "dependency_unavailable" });
	});
});
