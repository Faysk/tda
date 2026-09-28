import { describe, expect, it } from "vitest";
import {
	revisionSegmentId,
	validateTranscriptRevisionEdits,
} from "./revision-edit-contract";

const SESSION = "11111111-1111-4111-8111-111111111111";
const REVISION = "22222222-2222-4222-8222-222222222222";
const OPERATION = "33333333-3333-4333-8333-333333333333";

describe("transcript revision edit contract", () => {
	it("accepts an empty no-op intent and unicode speaker/text edits", () => {
		expect(
			validateTranscriptRevisionEdits({
				sessionId: SESSION,
				expectedCurrentRevisionId: REVISION,
				operationId: OPERATION,
				edits: [],
			}),
		).toEqual([]);
		expect(
			validateTranscriptRevisionEdits({
				sessionId: SESSION,
				expectedCurrentRevisionId: REVISION,
				operationId: OPERATION,
				edits: [
					{
						trackNumber: 7,
						segmentId: "fala-com-hifen",
						speaker: "Álya 🌲",
						text: "Coração, café e dragão 🐉",
					},
				],
			}),
		).toEqual([]);
	});

	it("rejects duplicate segment identities and invalid editorial strings", () => {
		const issues = validateTranscriptRevisionEdits({
			sessionId: SESSION,
			expectedCurrentRevisionId: REVISION,
			operationId: OPERATION,
			edits: [
				{ trackNumber: 1, segmentId: "a", speaker: "Mesa", text: "Primeira" },
				{ trackNumber: 1, segmentId: "a", speaker: "Mesa", text: "Segunda" },
				{ trackNumber: 2, segmentId: "b", speaker: "", text: "Ok" },
			],
		});
		expect(issues).toContain("duplicate_segment");
		expect(issues).toContain("speaker");
	});

	it("recovers the exact source segment id from the reader key", () => {
		expect(revisionSegmentId(12, "r-12-fala-a-b-c")).toBe("fala-a-b-c");
		expect(revisionSegmentId(2, "r-12-fala-a-b-c")).toBeNull();
	});
});
