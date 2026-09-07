import { describe, expect, it } from "vitest";
import {
	countTranscriptCharacters,
	countTranscriptWords,
	normalizeTranscriptReviewStatus,
	prepareTranscriptEdit,
	transcriptStatusNeedsReview,
} from "./model";

describe("transcript review status", () => {
	it("keeps the revalidated review states", () => {
		expect(normalizeTranscriptReviewStatus("pending")).toBe("pending");
		expect(normalizeTranscriptReviewStatus("approved")).toBe("approved");
		expect(normalizeTranscriptReviewStatus("needs_review")).toBe("needs_review");
		expect(normalizeTranscriptReviewStatus("discarded")).toBe("discarded");
	});

	it("accepts the legacy unreviewed alias as pending", () => {
		expect(normalizeTranscriptReviewStatus("unreviewed")).toBe("pending");
	});

	it("rejects unknown review states", () => {
		expect(normalizeTranscriptReviewStatus("published")).toBeNull();
		expect(normalizeTranscriptReviewStatus(null)).toBeNull();
	});

	it("derives needsReview from the review status", () => {
		expect(transcriptStatusNeedsReview("pending")).toBe(true);
		expect(transcriptStatusNeedsReview("needs_review")).toBe(true);
		expect(transcriptStatusNeedsReview("approved")).toBe(false);
		expect(transcriptStatusNeedsReview("discarded")).toBe(false);
	});
});

describe("transcript text metrics", () => {
	it("counts words using whitespace boundaries", () => {
		expect(countTranscriptWords("  uma   fala\ncom quatro  ")).toBe(4);
		expect(countTranscriptWords("   ")).toBe(0);
	});

	it("counts unicode code points instead of UTF-16 code units", () => {
		expect(countTranscriptCharacters("A😀B")).toBe(3);
	});
});

describe("prepareTranscriptEdit", () => {
	it("normalizes input and derives server-owned fields", () => {
		const result = prepareTranscriptEdit({
			text: "  A porta se abriu.  ",
			speaker: "  Dandelion  ",
			reviewStatus: "approved",
		});

		expect(result).toEqual({
			ok: true,
			value: {
				text: "A porta se abriu.",
				speaker: "Dandelion",
				reviewStatus: "approved",
				needsReview: false,
				textChars: 17,
				textWords: 4,
			},
		});
	});

	it("does not silently truncate invalid input", () => {
		const result = prepareTranscriptEdit({
			text: "x".repeat(10_001),
			speaker: "s".repeat(161),
			reviewStatus: "pending",
		});

		expect(result).toEqual({
			ok: false,
			issues: ["text_too_long", "speaker_too_long"],
		});
	});

	it("reports required and invalid fields together", () => {
		const result = prepareTranscriptEdit({
			text: "   ",
			speaker: null,
			reviewStatus: "wrong",
		});

		expect(result).toEqual({
			ok: false,
			issues: ["text_required", "speaker_required", "review_status_invalid"],
		});
	});
});