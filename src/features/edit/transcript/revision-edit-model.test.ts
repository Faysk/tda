import { describe, expect, it } from "vitest";
import type { TranscriptReaderSegment } from "./reader-contract";
import {
	applyTranscriptRevisionEdits,
	prepareTranscriptRevisionEdits,
} from "./revision-edit-model";

describe("prepareTranscriptRevisionEdits", () => {
	it("requires at least one changed segment", () => {
		expect(prepareTranscriptRevisionEdits([])).toEqual({
			ok: false,
			issues: ["patches_required"],
		});
	});

	it("normalizes one unicode patch without losing characters", () => {
		const result = prepareTranscriptRevisionEdits([
			{
				id: "r-1-seg-á",
				speaker: "  João 🐉  ",
				text: "  ação, bênção e café ☕  ",
			},
		]);
		expect(result).toEqual({
			ok: true,
			patches: [
				{
					id: "r-1-seg-á",
					speaker: "João 🐉",
					text: "ação, bênção e café ☕",
				},
			],
		});
	});

	it("rejects duplicate segment identities and timing-shaped input", () => {
		const result = prepareTranscriptRevisionEdits([
			{ id: "r-1-a", speaker: "A", text: "Um" },
			{ id: "r-1-a", speaker: "B", text: "Dois" },
			{ id: "r-2-b", speaker: "C", text: "Três", startMs: 999 },
		]);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.issues).toContain("patch_duplicate");
			expect(result.issues).toContain("patch_invalid");
		}
	});

	it("accepts a 7,500-segment working-copy delta", () => {
		const patches = Array.from({ length: 7_500 }, (_, index) => ({
			id: `r-1-seg-${index}`,
			speaker: `Jogador ${index}`,
			text: `Fala número ${index}`,
		}));
		const result = prepareTranscriptRevisionEdits(patches);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.patches).toHaveLength(7_500);
	});
});

describe("applyTranscriptRevisionEdits", () => {
	it("changes only speaker/text and preserves timing identity", () => {
		const original: TranscriptReaderSegment[] = [
			{
				id: "r-1-seg-1",
				trackNumber: 1,
				startMs: 1234,
				endMs: 5678,
				speaker: "Antes",
				text: "Texto antigo",
			},
		];
		const [edited] = applyTranscriptRevisionEdits(original, [
			{ id: "r-1-seg-1", speaker: "Depois", text: "Texto novo" },
		]);
		expect(edited).toEqual({
			id: "r-1-seg-1",
			trackNumber: 1,
			startMs: 1234,
			endMs: 5678,
			speaker: "Depois",
			text: "Texto novo",
		});
		expect(original[0].speaker).toBe("Antes");
	});
});
