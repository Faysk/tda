import { describe, expect, it } from "vitest";
import {
	TRANSCRIPT_EDIT_LIMITS,
	transcriptScalarLength,
	validateTranscriptEditRequest,
} from "./edit-model";

const base = {
	sessionId: "11111111-1111-4111-8111-111111111111",
	expectedCurrentTranscriptRevisionId: "22222222-2222-4222-8222-222222222222",
	operationId: "33333333-3333-4333-8333-333333333333",
	edits: [
		{
			trackNumber: 1,
			segmentId: "1-0",
			speaker: "Álya",
			text: "Coração da floresta 🌲",
		},
	],
} as const;

describe("transcript edit delta contract", () => {
	it("accepts Unicode speaker/text and exact scalar limits without truncation", () => {
		const input = {
			...base,
			edits: [
				{
					...base.edits[0],
					speaker: "🦆".repeat(TRANSCRIPT_EDIT_LIMITS.speaker),
					text: "á".repeat(TRANSCRIPT_EDIT_LIMITS.text),
				},
			],
		};
		expect(validateTranscriptEditRequest(input)).toEqual([]);
		expect(transcriptScalarLength(input.edits[0].speaker)).toBe(
			TRANSCRIPT_EDIT_LIMITS.speaker,
		);
	});

	it("rejects empty content, timing-shaped extra identity and duplicate segments", () => {
		expect(
			validateTranscriptEditRequest({
				...base,
				edits: [
					{ ...base.edits[0], text: "   " },
					{ ...base.edits[0], speaker: "Outra" },
				],
			}),
		).toEqual(expect.arrayContaining(["text", "duplicate_segment"]));
	});

	it("handles a 7,500-segment working-copy delta without an O(n²) validator", () => {
		const edits = Array.from({ length: 7_500 }, (_, index) => ({
			trackNumber: (index % 9) + 1,
			segmentId: `segment-${index}`,
			speaker: `Speaker ${index % 9}`,
			text: `Fala sintética ${index} 🦆`,
		}));
		expect(validateTranscriptEditRequest({ ...base, edits })).toEqual([]);
	});

	it("rejects invalid identities and content beyond the contract", () => {
		expect(
			validateTranscriptEditRequest({
				...base,
				operationId: "not-a-uuid",
				edits: [
					{
						...base.edits[0],
						speaker: "x".repeat(TRANSCRIPT_EDIT_LIMITS.speaker + 1),
					},
				],
			}),
		).toEqual(expect.arrayContaining(["operation_id", "speaker"]));
	});

	it("requires at least one changed segment", () => {
		expect(validateTranscriptEditRequest({ ...base, edits: [] })).toContain("edits");
	});
});
