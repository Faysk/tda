"use server";

import { unsafeUpdateTranscriptSegment } from "./unsafe-mutation";

export type UpdateTranscriptSegmentActionInput = Readonly<{
	sessionId: string;
	segmentId: string;
	text: string;
	speaker: string;
	reviewStatus: string;
}>;

export async function updateTranscriptSegmentAction(
	input: UpdateTranscriptSegmentActionInput,
) {
	try {
		return await unsafeUpdateTranscriptSegment({
			sessionId: input.sessionId,
			segmentId: input.segmentId,
			edit: {
				text: input.text,
				speaker: input.speaker,
				reviewStatus: input.reviewStatus,
			},
		});
	} catch (error) {
		console.error("[edit] unsafe transcript update failed", error);
		return { ok: false as const, issues: ["update_failed"] as const };
	}
}
