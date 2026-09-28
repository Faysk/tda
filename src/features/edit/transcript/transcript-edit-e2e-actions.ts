"use server";

import type { TranscriptEditRequest } from "./edit-model";
import {
	loseNextTranscriptEditResponse,
	saveTranscriptEditFixture,
	simulateTranscriptEditRemoteRevision,
} from "./transcript-edit-e2e-state";

function assertFixtureEnabled() {
	if (process.env.TDA_E2E_FIXTURES !== "true")
		throw new Error("Transcript edit E2E fixture is disabled");
}

export async function saveTranscriptEditFixtureAction(input: TranscriptEditRequest) {
	assertFixtureEnabled();
	const { result, loseResponse } = saveTranscriptEditFixture(input);
	if (loseResponse) throw new Error("synthetic lost response after commit");
	return result;
}

export async function simulateTranscriptEditRemoteRevisionAction() {
	assertFixtureEnabled();
	return simulateTranscriptEditRemoteRevision();
}

export async function loseNextTranscriptEditResponseAction() {
	assertFixtureEnabled();
	loseNextTranscriptEditResponse();
}
