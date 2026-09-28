"use server";

import { cookies } from "next/headers";
import type { SaveTranscriptRevisionActionInput } from "@/features/edit/transcript/revision-edit-actions";
import {
	prepareTranscriptRevisionEdits,
	type TranscriptRevisionEditPatch,
} from "@/features/edit/transcript/revision-edit-model";
import {
	parseTranscriptRevisionFixtureState,
	TRANSCRIPT_REVISION_FIXTURE_COOKIE,
} from "./state";

export async function saveTranscriptRevisionFixtureAction(
	forceConflict: boolean,
	loseFirstResponse: boolean,
	slowResponse: boolean,
	input: SaveTranscriptRevisionActionInput,
) {
	if (process.env.TDA_E2E_FIXTURES !== "true") {
		return { ok: false as const, reason: "dependency_unavailable" as const };
	}

	const prepared = prepareTranscriptRevisionEdits(input.edits);
	if (!prepared.ok) {
		return {
			ok: false as const,
			reason: "validation" as const,
			issues: prepared.issues,
		};
	}
	if (forceConflict) {
		return { ok: false as const, reason: "conflict" as const };
	}
	if (slowResponse) {
		await new Promise((resolve) => setTimeout(resolve, 350));
	}

	const store = await cookies();
	const current = parseTranscriptRevisionFixtureState(
		store.get(TRANSCRIPT_REVISION_FIXTURE_COOKIE)?.value,
	);
	if (
		current.operationId === input.operationId &&
		current.parentRevisionId === input.expectedCurrentRevisionId
	) {
		return {
			ok: true as const,
			status: "updated" as const,
			revisionId: current.revisionId,
			revisionNumber: current.revisionNumber,
			edits: prepared.patches,
		};
	}
	if (input.expectedCurrentRevisionId !== current.revisionId) {
		return { ok: false as const, reason: "conflict" as const };
	}

	const byId = new Map<string, TranscriptRevisionEditPatch>(
		current.patches.map((patch) => [patch.id, patch]),
	);
	for (const patch of prepared.patches) byId.set(patch.id, patch);

	const revisionId = crypto.randomUUID();
	const revisionNumber = current.revisionNumber + 1;
	store.set(
		TRANSCRIPT_REVISION_FIXTURE_COOKIE,
		JSON.stringify({
			revisionId,
			revisionNumber,
			patches: [...byId.values()],
			operationId: input.operationId,
			parentRevisionId: input.expectedCurrentRevisionId,
		}),
		{
			httpOnly: true,
			sameSite: "lax",
			path: "/e2e-fixtures/transcript-revision-editor",
		},
	);

	if (loseFirstResponse && current.revisionNumber === 1) {
		throw new Error("synthetic lost response after commit");
	}

	return {
		ok: true as const,
		status: "updated" as const,
		revisionId,
		revisionNumber,
		edits: prepared.patches,
	};
}
