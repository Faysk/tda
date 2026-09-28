import { describe, expect, it } from "vitest";
import {
	prepareTranscriptRevisionEdits,
	revisionSegmentId,
	toRevisionEdit,
} from "./revision-edit-contract";

describe("inline transcript revision edit contract", () => {
	it("keeps the original segment identity even when the id contains hyphens", () => {
		const segment = {
			id: "r-12-speaker-turn-a-b-c",
			trackNumber: 12,
			startMs: 1000,
			endMs: 2000,
			speaker: "Álya",
			text: "Texto",
		};
		expect(revisionSegmentId(segment)).toBe("speaker-turn-a-b-c");
		expect(toRevisionEdit(segment, " Sense ", " Coração 🌲 ")).toEqual({
			trackNumber: 12,
			segmentId: "speaker-turn-a-b-c",
			speaker: " Sense ",
			text: " Coração 🌲 ",
		});
	});

	it("normalizes outer whitespace without damaging unicode", () => {
		expect(
			prepareTranscriptRevisionEdits([
				{
					trackNumber: 1,
					segmentId: "1-0",
					speaker: "  Álya  ",
					text: "  Coração 🌲  ",
				},
			]),
		).toEqual({
			ok: true,
			value: [
				{
					trackNumber: 1,
					segmentId: "1-0",
					speaker: "Álya",
					text: "Coração 🌲",
				},
			],
		});
	});

	it("rejects duplicates and invalid empty edits", () => {
		const duplicate = {
			trackNumber: 1,
			segmentId: "same",
			speaker: "A",
			text: "Texto",
		};
		expect(prepareTranscriptRevisionEdits([duplicate, duplicate])).toEqual({
			ok: false,
			reason: "invalid_edits",
		});
		expect(
			prepareTranscriptRevisionEdits([
				{ ...duplicate, text: "   " },
			]),
		).toEqual({ ok: false, reason: "invalid_edits" });
	});

	it("never derives an editable identity from a legacy reader row", () => {
		expect(
			revisionSegmentId({
				id: "l-123",
				trackNumber: 1,
				startMs: 0,
				endMs: 1000,
				speaker: "Mesa",
				text: "Legado",
			}),
		).toBeNull();
	});
});
