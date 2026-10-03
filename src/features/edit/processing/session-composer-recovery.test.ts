import { describe, expect, it } from "vitest";
import {
	recordingVariantSourceIds,
} from "./session-composer-model";
import {
	confirmSessionComposerPendingSubmission,
	resolveSessionComposerPendingSubmission,
} from "./session-composer-storage";
import type {
	LocalSourceSummary,
	SessionWorkspace,
} from "./protocol";

class MemoryStorage implements Storage {
	private values = new Map<string, string>();

	get length() {
		return this.values.size;
	}
	clear() {
		this.values.clear();
	}
	getItem(key: string) {
		return this.values.get(key) ?? null;
	}
	key(index: number) {
		return Array.from(this.values.keys())[index] ?? null;
	}
	removeItem(key: string) {
		this.values.delete(key);
	}
	setItem(key: string, value: string) {
		this.values.set(key, value);
	}
}

const sourceA = `craig-${"a".repeat(64)}`;
const sourceB = `craig-${"b".repeat(64)}`;

function workspace(sourceId = sourceA): SessionWorkspace {
	return {
		schemaVersion: "tda_session_workspace_v1",
		campaignId: "yuhara-main",
		sessionId: "sessao-42",
		revision: 1,
		orderingMode: "attachment",
		createdAt: "2026-10-03T03:00:00.000Z",
		updatedAt: "2026-10-03T03:00:00.000Z",
		parts: [
			{
				partId: "1".repeat(32),
				sourceId,
				ordinal: 0,
				selectedRunId: null,
				sourceState: "ready",
				timelineMode: "automatic",
				sessionOffsetSeconds: 0,
				trimStartSeconds: 0,
				trimEndSeconds: null,
				gapConfirmed: false,
				overlapResolution: null,
				overlapBoundarySeconds: null,
				sourceStartTime: null,
				sourceStartConfidence: "missing",
				sourceStartUtc: null,
				sourceDurationSeconds: 300,
				effectiveStartSeconds: 0,
				effectiveEndSeconds: 300,
				relationToPrevious: "first",
				relationSeconds: null,
				overlapResolutionValid: true,
				createdAt: "2026-10-03T03:00:00.000Z",
				updatedAt: "2026-10-03T03:00:00.000Z",
			},
		],
		timeline: {
			policyVersion: "tda_session_timeline_v1",
			segmentBoundaryPolicy: "segment_start_owner_v1",
			fingerprintSha256: "2".repeat(64),
			state: "ready",
			allSourcesTrusted: false,
			automaticOrderAvailable: false,
			gapCount: 0,
			overlapCount: 0,
			orderConflictCount: 0,
			unresolvedOverlapCount: 0,
			unconfirmedGapCount: 0,
		},
	};
}

describe("session composer recovery invariants", () => {
	it("reuses the same pending enqueue identity after remount and rotates only after confirmation", async () => {
		const storage = new MemoryStorage();
		const requestSignature = JSON.stringify([
			"yuhara-main",
			"sessao-42",
			sourceA,
			"qwen-quality",
			"",
			"",
			false,
		]);
		const base = {
			storage,
			recoveryScope: "private-profile:yuhara-main",
			campaignId: "yuhara-main",
			sessionId: "sessao-42",
			sourceId: sourceA,
			profileId: "qwen-quality",
			requestSignature,
		} as const;

		const first = await resolveSessionComposerPendingSubmission({
			...base,
			createKey: () => "enqueue-key-first",
		});
		expect(first).toMatchObject({
			key: "enqueue-key-first",
			recoveredFromStorage: false,
		});

		const afterRemount = await resolveSessionComposerPendingSubmission({
			...base,
			createKey: () => "enqueue-key-must-not-be-used",
		});
		expect(afterRemount).toMatchObject({
			key: "enqueue-key-first",
			recoveredFromStorage: true,
		});

		confirmSessionComposerPendingSubmission(storage, afterRemount);
		const deliberateNewAttempt = await resolveSessionComposerPendingSubmission({
			...base,
			createKey: () => "enqueue-key-new",
		});
		expect(deliberateNewAttempt).toMatchObject({
			key: "enqueue-key-new",
			recoveredFromStorage: false,
		});
	});

	it("treats different bytes with the same recording identity as a variant requiring a decision", () => {
		const sources = new Map<string, LocalSourceSummary>([
			[
				sourceA,
				{
					sourceId: sourceA,
					sourceSha256: "a".repeat(64),
					recordingId: "craig-recording-42",
					trackCount: 2,
				},
			],
			[
				sourceB,
				{
					sourceId: sourceB,
					sourceSha256: "b".repeat(64),
					recordingId: "craig-recording-42",
					trackCount: 2,
				},
			],
		]);

		expect(
			recordingVariantSourceIds(sourceB, workspace(), sources),
		).toEqual([sourceA]);

		sources.set(sourceB, {
			...sources.get(sourceB)!,
			recordingId: "craig-recording-other",
		});
		expect(
			recordingVariantSourceIds(sourceB, workspace(), sources),
		).toEqual([]);
	});
});
