import type { TranscriptRevisionEditPatch } from "@/features/edit/transcript/revision-edit-model";
import type { TranscriptReaderSegment } from "@/features/edit/transcript/reader-contract";

export const TRANSCRIPT_REVISION_FIXTURE_COOKIE =
	"tda-e2e-transcript-revision-editor";
export const TRANSCRIPT_REVISION_FIXTURE_ID =
	"11111111-1111-4111-8111-111111111111";

export type TranscriptRevisionFixtureState = Readonly<{
	revisionId: string;
	revisionNumber: number;
	patches: readonly TranscriptRevisionEditPatch[];
}>;

export function transcriptRevisionFixtureSegments(): TranscriptReaderSegment[] {
	return Array.from({ length: 750 }, (_, index) => {
		const ordinal = index + 1;
		const trackNumber = (index % 4) + 1;
		return {
			id: `r-${trackNumber}-fixture-${ordinal}`,
			trackNumber,
			startMs: index * 1500,
			endMs: index * 1500 + 1200,
			speaker: `Pessoa ${trackNumber}`,
			text: `Fala sintética número ${ordinal}`,
		};
	});
}

export function parseTranscriptRevisionFixtureState(
	raw: string | undefined,
): TranscriptRevisionFixtureState {
	if (!raw) {
		return {
			revisionId: TRANSCRIPT_REVISION_FIXTURE_ID,
			revisionNumber: 1,
			patches: [],
		};
	}
	try {
		const value = JSON.parse(raw) as Record<string, unknown>;
		if (
			typeof value.revisionId !== "string" ||
			typeof value.revisionNumber !== "number" ||
			!Number.isSafeInteger(value.revisionNumber) ||
			value.revisionNumber < 1 ||
			!Array.isArray(value.patches)
		) {
			throw new Error("invalid");
		}
		const patches = value.patches.filter(
			(patch): patch is TranscriptRevisionEditPatch =>
				Boolean(
					patch &&
						typeof patch === "object" &&
						typeof (patch as Record<string, unknown>).id === "string" &&
						typeof (patch as Record<string, unknown>).speaker === "string" &&
						typeof (patch as Record<string, unknown>).text === "string",
				),
		);
		return {
			revisionId: value.revisionId,
			revisionNumber: value.revisionNumber,
			patches,
		};
	} catch {
		return {
			revisionId: TRANSCRIPT_REVISION_FIXTURE_ID,
			revisionNumber: 1,
			patches: [],
		};
	}
}
