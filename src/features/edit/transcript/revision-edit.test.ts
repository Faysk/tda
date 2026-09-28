import { describe, expect, it } from "vitest";
import { prepareTranscriptRevisionEditChanges } from "./revision-edit-model";
import { parseTranscriptRevisionEditResult } from "./revision-edit-persistence";

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
