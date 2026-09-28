import "server-only";

import {
	type TranscriptEditRequest,
	validateTranscriptEditRequest,
} from "./edit-model";
import type { TranscriptReaderSegment } from "./reader-contract";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

type SavedResult = Readonly<{
	ok: true;
	status: "updated" | "replay" | "no_change";
	revisionId: string;
	revisionNumber: number;
}>;

type FixtureState = {
	revisionId: string;
	revisionNumber: number;
	segments: TranscriptReaderSegment[];
	operations: Map<string, { signature: string; result: SavedResult }>;
	loseNextResponse: boolean;
};

type FixtureGlobal = typeof globalThis & {
	__TDA_TRANSCRIPT_EDIT_E2E_STATE__?: FixtureState;
};

function assertFixtureEnabled() {
	if (process.env.TDA_E2E_FIXTURES !== "true")
		throw new Error("Transcript edit E2E fixture is disabled");
}

function revisionId(revision: number): string {
	return `22222222-2222-4222-8222-${String(revision).padStart(12, "0")}`;
}

function initialSegments(): TranscriptReaderSegment[] {
	return Array.from({ length: 7_500 }, (_, index) => {
		const number = index + 1;
		return {
			id: `fixture-${number}`,
			sourceSegmentId: `segment-${number}`,
			trackNumber: (index % 5) + 1,
			startMs: index * 1_250,
			endMs: index * 1_250 + 900,
			speaker: `Speaker ${(index % 5) + 1}`,
			text:
				index === 0
					? "Primeira fala sintética para edição."
					: `Fala sintética ${number} da sessão longa.`,
		};
	});
}

function freshState(): FixtureState {
	return {
		revisionId: revisionId(1),
		revisionNumber: 1,
		segments: initialSegments(),
		operations: new Map(),
		loseNextResponse: false,
	};
}

function fixtureState(): FixtureState {
	const root = globalThis as FixtureGlobal;
	root.__TDA_TRANSCRIPT_EDIT_E2E_STATE__ ??= freshState();
	return root.__TDA_TRANSCRIPT_EDIT_E2E_STATE__;
}

export function resetTranscriptEditFixture() {
	assertFixtureEnabled();
	(globalThis as FixtureGlobal).__TDA_TRANSCRIPT_EDIT_E2E_STATE__ = freshState();
}

export function getTranscriptEditFixtureSnapshot() {
	assertFixtureEnabled();
	const state = fixtureState();
	return {
		sessionId: SESSION_ID,
		revisionId: state.revisionId,
		revisionNumber: state.revisionNumber,
		segments: state.segments.map((segment) => ({ ...segment })),
	};
}

export function simulateTranscriptEditRemoteRevision() {
	assertFixtureEnabled();
	const state = fixtureState();
	state.revisionNumber += 1;
	state.revisionId = revisionId(state.revisionNumber);
	state.segments = state.segments.map((segment, index) =>
		index === 1
			? {
					...segment,
					text: `${segment.text} · atualização remota r${state.revisionNumber}`,
				}
			: segment,
	);
	return state.revisionNumber;
}

export function loseNextTranscriptEditResponse() {
	assertFixtureEnabled();
	fixtureState().loseNextResponse = true;
}

export function saveTranscriptEditFixture(input: TranscriptEditRequest) {
	assertFixtureEnabled();
	const issues = validateTranscriptEditRequest(input);
	if (issues.length) {
		return {
			result: { ok: false as const, reason: "validation" as const, issues },
			loseResponse: false,
		};
	}

	const state = fixtureState();
	const signature = JSON.stringify(input.edits);
	const replay = state.operations.get(input.operationId);
	if (replay) {
		if (replay.signature !== signature) {
			return {
				result: {
					ok: false as const,
					reason: "invalid_edit_target" as const,
					issues: ["operation_conflict"] as const,
				},
				loseResponse: false,
			};
		}
		return {
			result: { ...replay.result, status: "replay" as const },
			loseResponse: false,
		};
	}

	if (input.sessionId !== SESSION_ID) {
		return {
			result: {
				ok: false as const,
				reason: "invalid_edit_target" as const,
				issues: ["invalid_edit_target"] as const,
			},
			loseResponse: false,
		};
	}

	if (input.expectedCurrentTranscriptRevisionId !== state.revisionId) {
		return {
			result: {
				ok: false as const,
				reason: "stale_current" as const,
				issues: ["stale_current"] as const,
				currentRevisionId: state.revisionId,
				currentRevisionNumber: state.revisionNumber,
			},
			loseResponse: false,
		};
	}

	const byIdentity = new Set(
		state.segments.map(
			(segment) =>
				`${segment.trackNumber}\u0000${segment.sourceSegmentId ?? ""}`,
		),
	);
	for (const edit of input.edits) {
		if (!byIdentity.has(`${edit.trackNumber}\u0000${edit.segmentId}`)) {
			return {
				result: {
					ok: false as const,
					reason: "invalid_edit_target" as const,
					issues: ["invalid_edit_target"] as const,
				},
				loseResponse: false,
			};
		}
	}

	const edits = new Map(
		input.edits.map((edit) => [
			`${edit.trackNumber}\u0000${edit.segmentId}`,
			edit,
		]),
	);
	let changed = 0;
	const nextSegments = state.segments.map((segment) => {
		const key = `${segment.trackNumber}\u0000${segment.sourceSegmentId ?? ""}`;
		const edit = edits.get(key);
		if (!edit) return segment;
		if (edit.speaker === segment.speaker && edit.text === segment.text)
			return segment;
		changed += 1;
		return { ...segment, speaker: edit.speaker, text: edit.text };
	});

	if (!changed) {
		const result: SavedResult = {
			ok: true,
			status: "no_change",
			revisionId: state.revisionId,
			revisionNumber: state.revisionNumber,
		};
		state.operations.set(input.operationId, { signature, result });
		return { result, loseResponse: false };
	}

	state.revisionNumber += 1;
	state.revisionId = revisionId(state.revisionNumber);
	state.segments = nextSegments;
	const result: SavedResult = {
		ok: true,
		status: "updated",
		revisionId: state.revisionId,
		revisionNumber: state.revisionNumber,
	};
	state.operations.set(input.operationId, { signature, result });
	const loseResponse = state.loseNextResponse;
	state.loseNextResponse = false;
	return { result, loseResponse };
}
