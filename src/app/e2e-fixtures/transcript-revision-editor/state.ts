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
	operationId?: string;
	parentRevisionId?: string;
}>;

type FixtureGlobal = typeof globalThis & {
	__tdaTranscriptRevisionFixtureStates?: Map<
		string,
		TranscriptRevisionFixtureState
	>;
};

function fixtureStateStore() {
	const target = globalThis as FixtureGlobal;
	target.__tdaTranscriptRevisionFixtureStates ??= new Map();
	return target.__tdaTranscriptRevisionFixtureStates;
}

function initialTranscriptRevisionFixtureState(): TranscriptRevisionFixtureState {
	return {
		revisionId: TRANSCRIPT_REVISION_FIXTURE_ID,
		revisionNumber: 1,
		patches: [],
	};
}

export function readTranscriptRevisionFixtureState(
	stateKey: string | undefined,
): TranscriptRevisionFixtureState {
	if (!stateKey) return initialTranscriptRevisionFixtureState();
	return (
		fixtureStateStore().get(stateKey) ?? initialTranscriptRevisionFixtureState()
	);
}

export function writeTranscriptRevisionFixtureState(
	stateKey: string,
	state: TranscriptRevisionFixtureState,
) {
	fixtureStateStore().set(stateKey, state);
}

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
