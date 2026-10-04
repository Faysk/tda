import { describe, expect, it, vi } from "vitest";
import { LocalBridge } from "./bridge";
import {
	moveSessionPart,
	pendingSourceIds,
	recordingVariantSourceIds,
	sessionAssemblyReadiness,
	supportsSessionComposer,
} from "./session-composer-model";
import {
	parseSessionAssembly,
	parseSessionAssemblyList,
	parseSessionAssemblyReviewSummary,
} from "./session-composer-protocol";
import type {
	LocalRunSummary,
	LocalSourceSummary,
	SessionParticipantMapping,
	SessionWorkspace,
	SessionWorkspacePart,
} from "./protocol";
import { LOCAL_API } from "./protocol";
import {
	confirmSessionComposerPendingSubmission,
	resolveSessionComposerPendingSubmission,
} from "./session-composer-storage";

const signal = () => new AbortController().signal;
const token = "synthetic_test_token_12345678901234567890";
const sourceA = "craig-" + "a".repeat(64);
const sourceB = "craig-" + "b".repeat(64);
const partA = "1".repeat(32);
const partB = "2".repeat(32);
const runA = "run-a";
const runB = "run-b";

function memoryStorage(): Storage {
	const values = new Map<string, string>();
	return {
		get length() {
			return values.size;
		},
		clear: () => values.clear(),
		getItem: (key: string) => values.get(key) ?? null,
		key: (index: number) => [...values.keys()][index] ?? null,
		removeItem: (key: string) => values.delete(key),
		setItem: (key: string, value: string) => values.set(key, value),
	} as Storage;
}

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

function part(
	partId: string,
	sourceId: string,
	ordinal: number,
	selectedRunId: string | null = null,
): SessionWorkspacePart {
	return {
		partId,
		sourceId,
		ordinal,
		selectedRunId,
		sourceState: "ready",
		timelineMode: "manual",
		sessionOffsetSeconds: ordinal * 100,
		trimStartSeconds: 0,
		trimEndSeconds: null,
		gapConfirmed: true,
		overlapResolution: null,
		overlapBoundarySeconds: null,
		sourceStartTime: null,
		sourceStartConfidence: "missing",
		sourceStartUtc: null,
		sourceDurationSeconds: 100,
		effectiveStartSeconds: ordinal * 100,
		effectiveEndSeconds: (ordinal + 1) * 100,
		relationToPrevious: ordinal === 0 ? "first" : "contiguous",
		relationSeconds: 0,
		overlapResolutionValid: false,
		physicalIntervalState: ordinal === 0 ? "first" : "manual",
		createdAt: "2026-09-28T00:00:00Z",
		updatedAt: "2026-09-28T00:00:00Z",
	};
}

function workspace(selected = true): SessionWorkspace {
	return {
		schemaVersion: "tda_session_workspace_v1",
		campaignId: "yuhara-main",
		sessionId: "session-42",
		revision: 4,
		orderingMode: "manual",
		createdAt: "2026-09-28T00:00:00Z",
		updatedAt: "2026-09-28T00:00:00Z",
		parts: [
			part(partA, sourceA, 0, selected ? runA : null),
			part(partB, sourceB, 1, selected ? runB : null),
		],
		timeline: {
			policyVersion: "tda_session_timeline_v2",
			segmentBoundaryPolicy: "segment_start_owner_v1",
			fingerprintSha256: "f".repeat(64),
			strategy: "manual_offsets",
			wallClock: "unavailable",
			unknownIntervalCount: 0,
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

function mapping(blocked = false): SessionParticipantMapping {
	return {
		schemaVersion: "tda_session_participant_mapping_v1",
		policy: "strong_discord_or_manual_v1",
		campaignId: "yuhara-main",
		sessionId: "session-42",
		workspaceRevision: 4,
		mappingSha256: "e".repeat(64),
		approvalBlocked: blocked,
		observations: [],
		participants: [],
		conflicts: [],
		manualAssignments: [],
	};
}

function rawWorkspace() {
	return {
		schema_version: "tda_session_workspace_v1",
		campaign_id: "yuhara-main",
		session_id: "session-42",
		revision: 5,
		ordering_mode: "manual",
		created_at: "2026-09-28T00:00:00Z",
		updated_at: "2026-09-28T00:00:01Z",
		parts: [
			{
				part_id: partA,
				source_id: sourceA,
				ordinal: 0,
				selected_run_id: runA,
				source_state: "ready",
				timeline_mode: "manual",
				session_offset_seconds: 0,
				trim_start_seconds: 0,
				trim_end_seconds: null,
				gap_confirmed: true,
				overlap_resolution: null,
				overlap_boundary_seconds: null,
				source_start_time: null,
				source_start_confidence: "missing",
				source_start_utc: null,
				source_duration_seconds: 100,
				effective_start_seconds: 0,
				effective_end_seconds: 100,
				relation_to_previous: "first",
				relation_seconds: 0,
				overlap_resolution_valid: false,
				physical_interval_state: "first",
				created_at: "2026-09-28T00:00:00Z",
				updated_at: "2026-09-28T00:00:01Z",
			},
		],
		timeline: {
			policy_version: "tda_session_timeline_v2",
			segment_boundary_policy: "segment_start_owner_v1",
			fingerprint_sha256: "f".repeat(64),
			strategy: "manual_offsets",
			wall_clock: "unavailable",
			unknown_interval_count: 0,
			state: "ready",
			all_sources_trusted: false,
			automatic_order_available: false,
			gap_count: 0,
			overlap_count: 0,
			order_conflict_count: 0,
			unresolved_overlap_count: 0,
			unconfirmed_gap_count: 0,
		},
	};
}

function rawAssembly() {
	return {
		schema_version: "tda_session_assembly_v1",
		assembly_id: "c".repeat(64),
		status: "completed",
		campaign_id: "yuhara-main",
		session_id: "session-42",
		canonicalization_version: "tda_session_assembly_canonical_v1",
		inputs_sha256: "c".repeat(64),
		timeline_fingerprint_sha256: "f".repeat(64),
		participant_mapping_sha256: "e".repeat(64),
		participant_approval_blocked: false,
		transcript_artifact: "transcript.json",
		transcript_sha256: "d".repeat(64),
		transcript_size_bytes: 512,
		segment_count: 12,
		created_at: "2026-09-28T00:01:00Z",
		parts: [
			{
				part_id: partA,
				source_id: sourceA,
				source_sha256: "a".repeat(64),
				run_id: runA,
				transcript_sha256: "1".repeat(64),
				ordinal: 0,
				session_offset_seconds: 0,
				trim_start_seconds: 0,
				trim_end_seconds: null,
				overlap_resolution: null,
				overlap_boundary_seconds: null,
			},
		],
	};
}

describe("multi-recording composer model", () => {
	it("gates the composer on the complete additive capability set", () => {
		expect(
			supportsSessionComposer([
				"transcription.session-workspace",
				"transcription.session-timeline",
				"transcription.session-participants",
				"transcription.session-assembly",
			]),
		).toBe(true);
		expect(
			supportsSessionComposer([
				"transcription.session-workspace",
				"transcription.session-timeline",
			]),
		).toBe(false);
	});

	it("reorders by accessible discrete moves without mutating the input", () => {
		const value = workspace();
		expect(moveSessionPart(value.parts, partB, -1)).toEqual([partB, partA]);
		expect(value.parts.map((item) => item.partId)).toEqual([partA, partB]);
		expect(moveSessionPart(value.parts, partA, -1)).toEqual([partA, partB]);
	});

	it("processes only sources without completed runs or active jobs", () => {
		const value = workspace(false);
		const run = { sourceId: sourceA } as LocalRunSummary;
		const runs = new Map<string, readonly LocalRunSummary[]>([
			[sourceA, [run]],
			[sourceB, []],
		]);
		expect(pendingSourceIds(value, runs)).toEqual([sourceB]);
		expect(
			pendingSourceIds(value, runs, [
				{
					status: "running",
					context: { campaignId: "yuhara-main", sessionId: "session-42", sourceId: sourceB },
				} as never,
			]),
		).toEqual([]);
		expect(
			pendingSourceIds(value, runs, [
				{
					status: "succeeded",
					context: { campaignId: "yuhara-main", sessionId: "session-42", sourceId: sourceB },
				} as never,
			]),
		).toEqual([]);
	});

	it("keeps assembly fail-closed until chronology, runs and participants are ready", () => {
		expect(sessionAssemblyReadiness(workspace(), mapping())).toEqual({
			ready: true,
			reasons: [],
		});
		const withoutRun = sessionAssemblyReadiness(workspace(false), mapping());
		expect(withoutRun.ready).toBe(false);
		expect(withoutRun.reasons).toContain(
			"Selecione um resultado para cada gravação.",
		);
		const ambiguous = sessionAssemblyReadiness(workspace(), mapping(true));
		expect(ambiguous.ready).toBe(false);
		expect(ambiguous.reasons).toContain(
			"Resolva os participantes ambíguos.",
		);
	});
});


describe("session composer recovery and recording provenance", () => {
	it("reuses the persisted idempotency key after an ambiguous selective enqueue", async () => {
		const storage = new MemoryStorage();
		const input = {
			storage,
			recoveryScope: "private-profile:yuhara-main",
			campaignId: "yuhara-main",
			sessionId: "session-42",
			sourceId: sourceB,
			profileId: "qwen-quality",
			requestSignature: JSON.stringify([
				"yuhara-main",
				"session-42",
				sourceB,
				"qwen-quality",
				"",
				"",
				false,
			]),
		} as const;

		const first = await resolveSessionComposerPendingSubmission({
			...input,
			createKey: () => "composer-key-1",
		});
		expect(first.key).toBe("composer-key-1");
		expect(first.recoveredFromStorage).toBe(false);

		const recovered = await resolveSessionComposerPendingSubmission({
			...input,
			existing: null,
			createKey: () => "composer-key-2",
		});
		expect(recovered.key).toBe(first.key);
		expect(recovered.recoveredFromStorage).toBe(true);

		confirmSessionComposerPendingSubmission(storage, recovered);
		const afterConfirmation = await resolveSessionComposerPendingSubmission({
			...input,
			existing: null,
			createKey: () => "composer-key-3",
		});
		expect(afterConfirmation.key).toBe("composer-key-3");
		expect(afterConfirmation.recoveredFromStorage).toBe(false);
	});

	it("distinguishes same recording_id with different source bytes from an exact duplicate", () => {
		const sources = new Map<string, LocalSourceSummary>([
			[
				sourceA,
				{
					sourceId: sourceA,
					sourceSha256: "a".repeat(64),
					recordingId: "craig-recording-42",
					trackCount: 1,
				},
			],
			[
				sourceB,
				{
					sourceId: sourceB,
					sourceSha256: "b".repeat(64),
					recordingId: "craig-recording-42",
					trackCount: 1,
				},
			],
		]);
		const value = workspace(false);
		expect(recordingVariantSourceIds(sourceB, value, sources)).toEqual([sourceA]);
		expect(recordingVariantSourceIds(sourceA, value, sources)).toEqual([sourceB]);
	});
});

describe("session composer enqueue recovery", () => {
	it("reuses the same idempotency key after an ambiguous response and clears it only after confirmation", async () => {
		const storage = memoryStorage();
		const requestSignature = JSON.stringify([
			"yuhara-main",
			"session-42",
			sourceA,
			"qwen-quality",
			"",
			"",
			false,
		]);
		const first = await resolveSessionComposerPendingSubmission({
			storage,
			recoveryScope: "profile-synthetic",
			campaignId: "yuhara-main",
			sessionId: "session-42",
			sourceId: sourceA,
			profileId: "qwen-quality",
			requestSignature,
			createKey: () => "composer-key-1",
		});
		expect(first.key).toBe("composer-key-1");
		expect(first.recoveredFromStorage).toBe(false);

		const recovered = await resolveSessionComposerPendingSubmission({
			storage,
			recoveryScope: "profile-synthetic",
			campaignId: "yuhara-main",
			sessionId: "session-42",
			sourceId: sourceA,
			profileId: "qwen-quality",
			requestSignature,
			createKey: () => "composer-key-should-not-be-used",
		});
		expect(recovered.key).toBe(first.key);
		expect(recovered.recoveredFromStorage).toBe(true);

		confirmSessionComposerPendingSubmission(storage, recovered);
		const afterConfirmation = await resolveSessionComposerPendingSubmission({
			storage,
			recoveryScope: "profile-synthetic",
			campaignId: "yuhara-main",
			sessionId: "session-42",
			sourceId: sourceA,
			profileId: "qwen-quality",
			requestSignature,
			createKey: () => "composer-key-2",
		});
		expect(afterConfirmation.key).toBe("composer-key-2");
		expect(afterConfirmation.recoveredFromStorage).toBe(false);
	});
});

describe("confirmed sequence web contracts", () => {
	it("parses user-confirmed sequence provenance without treating unknown intervals as facts", () => {
		const raw = rawWorkspace();
		raw.parts = [
			raw.parts[0],
			{
				...raw.parts[0],
				part_id: partB,
				source_id: sourceB,
				ordinal: 1,
				selected_run_id: runB,
				timeline_mode: "sequence",
				session_offset_seconds: 100,
				effective_start_seconds: 100,
				effective_end_seconds: 200,
				relation_to_previous: "contiguous",
				physical_interval_state: "unknown",
			},
		];
		raw.parts[0] = {
			...raw.parts[0],
			timeline_mode: "sequence",
		};
		raw.timeline = {
			...raw.timeline,
			strategy: "user_confirmed_sequence",
			wall_clock: "unavailable",
			unknown_interval_count: 1,
		};

		const parsed = new LocalBridge(
			vi.fn<typeof fetch>().mockResolvedValue(Response.json(raw)),
		);
		parsed.pair(token);
		return expect(
			parsed.sessionWorkspace("yuhara-main", "session-42", signal()),
		).resolves.toMatchObject({
			timeline: {
				strategy: "user_confirmed_sequence",
				wallClock: "unavailable",
				unknownIntervalCount: 1,
			},
			parts: [
				{ physicalIntervalState: "first" },
				{ physicalIntervalState: "unknown" },
			],
		});
	});
});

describe("session assembly web contracts", () => {
	it("parses a bounded immutable assembly and listing", () => {
		const parsed = parseSessionAssembly(rawAssembly());
		expect(parsed).toMatchObject({
			assemblyId: "c".repeat(64),
			segmentCount: 12,
			participantApprovalBlocked: false,
		});
		const listing = parseSessionAssemblyList({
			schema_version: "tda_session_assemblies_v1",
			campaign_id: "yuhara-main",
			session_id: "session-42",
			assemblies: [
				{
					assembly_id: "c".repeat(64),
					transcript_sha256: "d".repeat(64),
					inputs_sha256: "c".repeat(64),
					segment_count: 12,
					part_count: 1,
					participant_approval_blocked: false,
					created_at: "2026-09-28T00:01:00Z",
				},
			],
		});
		expect(listing.assemblies[0]?.partCount).toBe(1);
	});

	it("loads review authority from the assembly identity, not a source run", () => {
		const review = parseSessionAssemblyReviewSummary(
			{
				schema_version: "tda_session_assembly_review_v1",
				snapshot_contract: "tda_session_assembly_review_cas_v1",
				persistence: "ephemeral_base",
				base: {
					kind: "session_assembly",
					assembly_id: "c".repeat(64),
					transcript_sha256: "d".repeat(64),
					inputs_sha256: "c".repeat(64),
				},
				draft_revision: null,
				draft_sha256: null,
				status: "draft",
				approval_current: false,
				approval_blocked: false,
				approved_at: null,
				created_at: null,
				updated_at: null,
				review: {
					reviewed_segments: 0,
					total_segments: 2,
					review_percent: 0,
					edited_segments: 0,
					word_count: 4,
				},
				segments: [
					{
						assembly_segment_id: "e".repeat(64),
						part_id: "1".repeat(32),
						source_id: sourceA,
						run_id: runA,
						source_segment_id: "source-a",
						track_number: 1,
						participant_id: "3".repeat(32),
						start: 1,
						end: 2,
						speaker: "Alya",
						text: "Primeira fala",
						reviewed: false,
					},
					{
						assembly_segment_id: "f".repeat(64),
						part_id: "2".repeat(32),
						source_id: sourceB,
						run_id: runB,
						source_segment_id: "source-b",
						track_number: 2,
						participant_id: "4".repeat(32),
						start: 3,
						end: 4,
						speaker: "Noah",
						text: "Segunda fala",
						reviewed: false,
					},
				],
			},
			"c".repeat(64),
		);
		expect(review).toMatchObject({
			assemblyId: "c".repeat(64),
			baseTranscriptSha256: "d".repeat(64),
			segmentCount: 2,
			status: "draft",
		});
		expect(review.segments.map((segment) => segment.assemblySegmentId)).toEqual([
			"e".repeat(64),
			"f".repeat(64),
		]);
		expect(() =>
			parseSessionAssemblyReviewSummary(
				{
					schema_version: "tda_session_assembly_review_v1",
					snapshot_contract: "tda_session_assembly_review_cas_v1",
					persistence: "ephemeral_base",
					base: {
						kind: "run",
						assembly_id: "c".repeat(64),
						transcript_sha256: "d".repeat(64),
					},
					draft_revision: null,
					draft_sha256: null,
					status: "draft",
					approval_current: false,
					approval_blocked: false,
					review: {
						reviewed_segments: 0,
						total_segments: 0,
						review_percent: 100,
						edited_segments: 0,
						word_count: 0,
					},
					segments: [],
				},
				"c".repeat(64),
			),
		).toThrow();
	});

	it("uses fixed CAS routes for selecting a run, building an assembly and opening its review", async () => {
		const request = vi.fn<typeof fetch>().mockImplementation(async (url) => {
			const value = String(url);
			if (value.endsWith("/parts/run")) return Response.json(rawWorkspace());
			if (value.endsWith("/assemblies")) return Response.json(rawAssembly());
			if (value.endsWith("/review/base"))
				return Response.json({
					schema_version: "tda_session_assembly_review_v1",
					snapshot_contract: "tda_session_assembly_review_cas_v1",
					persistence: "ephemeral_base",
					base: {
						kind: "session_assembly",
						assembly_id: "c".repeat(64),
						transcript_sha256: "d".repeat(64),
						inputs_sha256: "c".repeat(64),
					},
					draft_revision: null,
					draft_sha256: null,
					status: "draft",
					approval_current: false,
					approval_blocked: false,
					approved_at: null,
					created_at: null,
					updated_at: null,
					review: {
						reviewed_segments: 0,
						total_segments: 0,
						review_percent: 100,
						edited_segments: 0,
						word_count: 0,
					},
					segments: [],
				});
			throw new Error("unexpected request " + value);
		});
		const bridge = new LocalBridge(request);
		bridge.pair(token);

		await bridge.selectSessionPartRun(
			"yuhara-main",
			"session-42",
			partA,
			runA,
			4,
			signal(),
		);
		const built = await bridge.buildSessionAssembly(
			"yuhara-main",
			"session-42",
			5,
			signal(),
		);
		const review = await bridge.sessionAssemblyReviewBase(
			"yuhara-main",
			"session-42",
			built.assemblyId,
			signal(),
		);

		expect(review.assemblyId).toBe(built.assemblyId);
		expect(request.mock.calls.map(([url]) => String(url))).toEqual([
			LOCAL_API + "/session-workspaces/yuhara-main/session-42/parts/run",
			LOCAL_API + "/session-workspaces/yuhara-main/session-42/assemblies",
			LOCAL_API +
				"/session-workspaces/yuhara-main/session-42/assemblies/" +
				"c".repeat(64) +
				"/review/base",
		]);
		expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({
			part_id: partA,
			run_id: runA,
			expected_revision: 4,
		});
		expect(JSON.parse(String(request.mock.calls[1]?.[1]?.body))).toEqual({
			expected_revision: 5,
		});
		bridge.disconnect();
	});
});
