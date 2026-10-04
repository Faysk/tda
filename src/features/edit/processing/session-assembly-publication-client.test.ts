import { describe, expect, it, vi } from "vitest";
import type {
	SessionAssembly,
	SessionAssemblyReviewSummary,
} from "./session-composer-protocol";
import {
	publishApprovedSessionAssemblyReview,
	readCurrentSessionAssemblyPublication,
	sessionAssemblyPublicationRequestBody,
} from "./session-assembly-publication-client";

const OPERATION = "11111111-1111-4111-8111-111111111111";
const ACTOR = "22222222-2222-4222-8222-222222222222";
const REVISION = "33333333-3333-4333-8333-333333333333";
const RECEIPT = "44444444-4444-4444-8444-444444444444";
const SOURCE_A_SHA = "a".repeat(64);
const SOURCE_B_SHA = "b".repeat(64);
const SOURCE_A = "craig-" + SOURCE_A_SHA;
const SOURCE_B = "craig-" + SOURCE_B_SHA;

function assembly(): SessionAssembly {
	return {
		schemaVersion: "tda_session_assembly_v1",
		canonicalizationVersion: "tda_session_assembly_canonical_v2",
		timingPolicyVersion: "tda_session_timeline_v2",
		segmentBoundaryPolicy: "segment_start_owner_v1",
		assemblyId: "1".repeat(64),
		campaignId: "yuhara-main",
		sessionId: "sessao-1118",
		inputsSha256: "1".repeat(64),
		timelineFingerprintSha256: "2".repeat(64),
		timelineStrategy: "user_confirmed_sequence",
		wallClock: "partial",
		unknownIntervalCount: 1,
		participantMappingSha256: "3".repeat(64),
		participantApprovalBlocked: false,
		transcriptSha256: "4".repeat(64),
		transcriptSizeBytes: 2048,
		segmentCount: 2,
		createdAt: "2026-09-30T00:00:00Z",
		parts: [
			{
				partId: "5".repeat(32),
				sourceId: SOURCE_A,
				sourceSha256: SOURCE_A_SHA,
				runId: "run-a",
				transcriptSha256: "6".repeat(64),
				ordinal: 0,
				sessionOffsetSeconds: 0,
				trimStartSeconds: 0,
				trimEndSeconds: null,
				overlapResolution: null,
				overlapBoundarySeconds: null,
				physicalIntervalState: "first",
			},
			{
				partId: "7".repeat(32),
				sourceId: SOURCE_B,
				sourceSha256: SOURCE_B_SHA,
				runId: "run-b",
				transcriptSha256: "8".repeat(64),
				ordinal: 1,
				sessionOffsetSeconds: 90_000,
				trimStartSeconds: 0,
				trimEndSeconds: null,
				overlapResolution: null,
				overlapBoundarySeconds: null,
				physicalIntervalState: "unknown",
			},
		],
	};
}

function review(): SessionAssemblyReviewSummary {
	return {
		assemblyId: "1".repeat(64),
		baseTranscriptSha256: "4".repeat(64),
		status: "approved_local",
		persistence: "persisted",
		draftRevision: 2,
		draftSha256: "9".repeat(64),
		approvalCurrent: true,
		approvalBlocked: false,
		segmentCount: 2,
		reviewedSegments: 2,
		reviewPercent: 100,
		editedSegments: 1,
		wordCount: 4,
		segments: [
			{
				assemblySegmentId: "c".repeat(64),
				partId: "5".repeat(32),
				sourceId: SOURCE_A,
				runId: "run-a",
				sourceSegmentId: "seg-a",
				trackNumber: 1,
				participantId: "d".repeat(32),
				start: 0,
				end: 1,
				absoluteTime: {
					startIso: "2026-09-29T23:59:59+01:00",
					endIso: "2026-09-30T00:00:00+01:00",
					source: SOURCE_A,
				},
				speaker: "Alya",
				text: "fala um",
				reviewed: true,
			},
			{
				assemblySegmentId: "e".repeat(64),
				partId: "7".repeat(32),
				sourceId: SOURCE_B,
				runId: "run-b",
				sourceSegmentId: "seg-b",
				trackNumber: 2,
				participantId: "f".repeat(32),
				start: 90_000,
				end: 90_001,
				absoluteTime: null,
				speaker: "Noah",
				text: "fala dois",
				reviewed: true,
			},
		],
	};
}

function receipt() {
	return {
		ok: true,
		receipt: {
			schemaVersion: "tda_transcript_publication_receipt_v2",
			status: "committed",
			receiptId: RECEIPT,
			campaignId: "55555555-5555-4555-8555-555555555555",
			sessionId: "66666666-6666-4666-8666-666666666666",
			revisionId: REVISION,
			revisionNumber: 4,
			operationId: OPERATION,
			assemblyId: "1".repeat(64),
			partCount: 2,
			baseTranscriptSha256: "4".repeat(64),
			draftSha256: "9".repeat(64),
			payloadSha256: "0".repeat(64),
			segmentCount: 2,
			wordCount: 4,
			committedAt: "2026-09-30T01:00:00Z",
		},
	};
}

describe("Session Assembly publication client", () => {
	it("builds the canonical v2 handoff from exact Assembly provenance", () => {
		const body = sessionAssemblyPublicationRequestBody(
			assembly(),
			review(),
			OPERATION,
			null,
			ACTOR,
		);
		expect(body).toMatchObject({
			schemaVersion: "tda_transcript_publication_request_v2",
			operationId: OPERATION,
			expectedActorProfileId: ACTOR,
			target: {
				campaignSlug: "yuhara-main",
				sourceSessionId: "sessao-1118",
			},
			assembly: {
				canonicalizationVersion: "tda_session_assembly_canonical_v2",
				timingPolicyVersion: "tda_session_timeline_v2",
				timelineStrategy: "user_confirmed_sequence",
				wallClock: "partial",
				unknownIntervalCount: 1,
				assemblyId: "1".repeat(64),
				parts: [
					expect.objectContaining({ sourceId: SOURCE_A, runId: "run-a", ordinal: 0 }),
					expect.objectContaining({ sourceId: SOURCE_B, runId: "run-b", ordinal: 1 }),
				],
			},
			review: {
				status: "approved_local",
				draftRevision: 2,
				draftSha256: "9".repeat(64),
			},
		});
		expect(body.review.segments[0]).toMatchObject({
			assemblySegmentId: "c".repeat(64),
			absoluteTime: review().segments[0]?.absoluteTime,
		});
		expect(JSON.stringify(body)).not.toContain("\\Users\\");
	});

	it("fails before transport when the exact persisted approval is not current", async () => {
		const stale = { ...review(), approvalCurrent: false };
		const transport = vi.fn<typeof fetch>();
		await expect(
			publishApprovedSessionAssemblyReview(
				assembly(),
				stale,
				OPERATION,
				null,
				transport,
				ACTOR,
			),
		).rejects.toMatchObject({ code: "approved_review_required" });
		expect(transport).not.toHaveBeenCalled();
	});

	it("reconciles an ambiguous POST with the same byte-identical receipt lookup", async () => {
		const transport = vi
			.fn<typeof fetch>()
			.mockRejectedValueOnce(new TypeError("connection reset"))
			.mockResolvedValueOnce(Response.json(receipt()));
		await expect(
			publishApprovedSessionAssemblyReview(
				assembly(),
				review(),
				OPERATION,
				null,
				transport,
				ACTOR,
			),
		).resolves.toMatchObject({ revisionId: REVISION, revisionNumber: 4 });
		expect(transport.mock.calls.map(([path]) => path)).toEqual([
			"/api/transcript-publications",
			"/api/transcript-publications/receipt",
		]);
		expect(transport.mock.calls[0]?.[1]?.body).toBe(
			transport.mock.calls[1]?.[1]?.body,
		);
	});

	it("propagates stale cloud CAS without retrying a second mutation", async () => {
		const transport = vi
			.fn<typeof fetch>()
			.mockResolvedValue(
				Response.json({ ok: false, reason: "stale_current" }, { status: 409 }),
			);
		await expect(
			publishApprovedSessionAssemblyReview(
				assembly(),
				review(),
				OPERATION,
				REVISION,
				transport,
				ACTOR,
			),
		).rejects.toMatchObject({ code: "stale_current" });
		expect(transport).toHaveBeenCalledTimes(1);
	});

	it("reads the private current revision before creating a new handoff identity", async () => {
		const transport = vi.fn<typeof fetch>().mockResolvedValue(
			Response.json({
				ok: true,
				current: { actorProfileId: ACTOR, revisionId: REVISION },
			}),
		);
		await expect(
			readCurrentSessionAssemblyPublication(assembly(), transport),
		).resolves.toEqual({ actorProfileId: ACTOR, revisionId: REVISION });
		expect(JSON.parse(String(transport.mock.calls[0]?.[1]?.body))).toEqual({
			campaignSlug: "yuhara-main",
			sourceSessionId: "sessao-1118",
		});
	});
});
