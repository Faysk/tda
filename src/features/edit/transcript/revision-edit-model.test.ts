import { describe, expect, it } from "vitest";
import type { TranscriptReaderSegment } from "./reader-contract";
import {
	applyTranscriptRevisionPatches,
	rebaseTranscriptPatches,
	summarizeTranscriptRebase,
	validateTranscriptRevisionEditInput,
} from "./revision-edit-model";

const SESSION = "11111111-1111-4111-8111-111111111111";
const REVISION = "22222222-2222-4222-8222-222222222222";
const OPERATION = "33333333-3333-4333-8333-333333333333";

function row(index: number): TranscriptReaderSegment {
	return {
		id: `r-${(index % 8) + 1}-seg-${index}`,
		trackNumber: (index % 8) + 1,
		startMs: index * 1100,
		endMs: index * 1100 + 950,
		speaker: `Speaker ${index % 12}`,
		text: `Fala de teste ${index}`,
	};
}

describe("transcript revision edit model", () => {
	it("validates Unicode and rejects duplicate or empty patches", () => {
		expect(validateTranscriptRevisionEditInput({
			sessionId: SESSION,
			expectedCurrentTranscriptRevisionId: REVISION,
			operationId: OPERATION,
			patches: [{ id: "r-1-seg-1", speaker: "Alya", text: "Ola, mundo." }],
		})).toEqual([]);
		expect(validateTranscriptRevisionEditInput({
			sessionId: SESSION,
			expectedCurrentTranscriptRevisionId: REVISION,
			operationId: OPERATION,
			patches: [
				{ id: "same", speaker: "A", text: "um" },
				{ id: "same", speaker: "B", text: "   " },
			],
		})).toEqual(expect.arrayContaining(["duplicate_patch", "text"]));
	});

	it("changes only speaker/text and keeps timing/identity", () => {
		const baseline = [row(0), row(1), row(2)];
		const next = applyTranscriptRevisionPatches(baseline, [{
			id: baseline[1].id,
			speaker: "Sense",
			text: "Texto corrigido.",
		}]);
		expect(next[1]).toEqual({ ...baseline[1], speaker: "Sense", text: "Texto corrigido." });
		expect(next[1].startMs).toBe(baseline[1].startMs);
		expect(next[1].endMs).toBe(baseline[1].endMs);
	});

	it("handles a 7,500 segment transcript with a sparse working copy", () => {
		const baseline = Array.from({ length: 7500 }, (_, index) => row(index));
		const patches = Array.from({ length: 50 }, (_, index) => ({
			id: baseline[index * 149].id,
			speaker: `Reviewer ${index}`,
			text: `Correction ${index}`,
		}));
		const next = applyTranscriptRevisionPatches(baseline, patches);
		expect(next).toHaveLength(7500);
		expect(next[149].text).toBe("Correction 1");
		expect(next[149].startMs).toBe(baseline[149].startMs);
		expect(next[7499]).toEqual(baseline[7499]);
	});

	it("detects collisions and rebases only fields changed locally", () => {
		const baseline = [row(0), row(1)];
		const local = [{ id: baseline[0].id, speaker: "Local", text: baseline[0].text }];
		const remote = [
			{ ...baseline[0], speaker: "Remote" },
			{ ...baseline[1], text: "Remote text" },
		];
		expect(summarizeTranscriptRebase(baseline, remote, local)).toEqual({
			compatible: true,
			remoteChangedSegments: 2,
			collisions: 1,
		});
		expect(rebaseTranscriptPatches(baseline, remote, local)).toEqual([
			{ id: baseline[0].id, speaker: "Local", text: baseline[0].text },
		]);
	});

	it("preserves an independent remote field during rebase", () => {
		const baseline = [row(0)];
		const local = [{ id: baseline[0].id, speaker: "Local", text: baseline[0].text }];
		const remote = [{ ...baseline[0], text: "Remote text" }];
		expect(rebaseTranscriptPatches(baseline, remote, local)).toEqual([
			{ id: baseline[0].id, speaker: "Local", text: "Remote text" },
		]);
	});

	it("fails closed when timing changes", () => {
		const baseline = [row(0)];
		const remote = [{ ...baseline[0], startMs: baseline[0].startMs + 1 }];
		expect(summarizeTranscriptRebase(baseline, remote, [])).toEqual({
			compatible: false,
			remoteChangedSegments: 0,
			collisions: 0,
		});
	});
});
