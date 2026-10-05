import { describe, expect, it, vi } from "vitest";
import { LocalBridge } from "./bridge";
import {
	LOCAL_API,
	parseSessionParticipantMapping,
	parseSessionTranscriptionIntent,
	parseSessionWorkspace,
} from "./protocol";

const signal = () => new AbortController().signal;
const token = "synthetic_test_token_12345678901234567890";
const sourceA = `craig-${"a".repeat(64)}`;
const sourceB = `craig-${"b".repeat(64)}`;
const partA = "1".repeat(32);
const partB = "2".repeat(32);

function recordingPart(overrides: Record<string, unknown> = {}) {
	return {
		part_id: partA,
		source_id: sourceA,
		ordinal: 0,
		selected_run_id: null,
		source_state: "ready",
		timeline_mode: "manual",
		session_offset_seconds: 0,
		trim_start_seconds: 0,
		trim_end_seconds: null,
		gap_confirmed: false,
		overlap_resolution: null,
		overlap_boundary_seconds: null,
		source_start_time: "2026-09-27T20:00:00Z",
		source_start_confidence: "trusted_absolute",
		source_start_utc: "2026-09-27T20:00:00Z",
		source_duration_seconds: 3600,
		effective_start_seconds: 0,
		effective_end_seconds: 3600,
		relation_to_previous: "first",
		relation_seconds: 0,
		overlap_resolution_valid: false,
		physical_interval_state: "first",
		created_at: "2026-09-27T22:30:00Z",
		updated_at: "2026-09-27T22:30:00Z",
		...overrides,
	};
}

function workspace(parts = [recordingPart()]) {
	return {
		schema_version: "tda_session_workspace_v1",
		campaign_id: "yuhara-main",
		session_id: "session-42",
		revision: parts.length,
		ordering_mode: "manual",
		created_at: "2026-09-27T22:30:00Z",
		updated_at: "2026-09-27T22:31:00Z",
		fresh_start_at: null as string | null,
		fresh_start_excluded_job_ids: [] as string[],
		parts,
		timeline: {
			policy_version: "tda_session_timeline_v2",
			segment_boundary_policy: "segment_start_owner_v1",
			fingerprint_sha256: "f".repeat(64),
			strategy: "manual_offsets",
			wall_clock: "trusted",
			unknown_interval_count: 0,
			state: "ready",
			all_sources_trusted: true,
			automatic_order_available: true,
			gap_count: 0,
			overlap_count: 0,
			unresolved_overlap_count: 0,
			unconfirmed_gap_count: 0,
		},
	};
}

describe("session workspace protocol", () => {
	it("parses sanitized chronology and timing provenance", () => {
		const parsed = parseSessionWorkspace(workspace());
		expect(parsed).toMatchObject({
			schemaVersion: "tda_session_workspace_v1",
			campaignId: "yuhara-main",
			sessionId: "session-42",
			revision: 1,
			orderingMode: "manual",
			freshStartAt: null,
			freshStartExcludedJobIds: [],
			parts: [
				{
					partId: partA,
					sourceId: sourceA,
					ordinal: 0,
					selectedRunId: null,
					sourceState: "ready",
					timelineMode: "manual",
					sessionOffsetSeconds: 0,
					gapConfirmed: false,
					sourceStartConfidence: "trusted_absolute",
					effectiveStartSeconds: 0,
					effectiveEndSeconds: 3600,
					relationToPrevious: "first",
				},
			],
			timeline: {
				policyVersion: "tda_session_timeline_v2",
				segmentBoundaryPolicy: "segment_start_owner_v1",
				fingerprintSha256: "f".repeat(64),
				strategy: "manual_offsets",
				wallClock: "trusted",
				unknownIntervalCount: 0,
				state: "ready",
			},
		});
		expect(JSON.stringify(parsed)).not.toContain("path");
		expect(JSON.stringify(parsed)).not.toContain("transcript");
	});

	it("parses fresh-start generation metadata and excluded historical jobs", () => {
		const raw = workspace();
		raw.fresh_start_at = "2026-10-05T20:00:00.000Z";
		raw.fresh_start_excluded_job_ids = ["old-job-a", "old-job-b"];
		const parsed = parseSessionWorkspace(raw);
		expect(parsed.freshStartAt).toBe("2026-10-05T20:00:00.000Z");
		expect(parsed.freshStartExcludedJobIds).toEqual([
			"old-job-a",
			"old-job-b",
		]);
	});

	it("keeps Stable timeline v1 workspaces readable without inventing v2 provenance", () => {
		const legacy = workspace();
		legacy.timeline.policy_version = "tda_session_timeline_v1";
		delete (legacy.timeline as Record<string, unknown>).strategy;
		delete (legacy.timeline as Record<string, unknown>).wall_clock;
		delete (legacy.timeline as Record<string, unknown>).unknown_interval_count;
		delete (legacy.parts[0] as Record<string, unknown>).physical_interval_state;

		const parsed = parseSessionWorkspace(legacy);

		expect(parsed.timeline).toMatchObject({
			policyVersion: "tda_session_timeline_v1",
			strategy: null,
			wallClock: null,
			unknownIntervalCount: null,
			state: "ready",
		});
		expect(parsed.parts[0].physicalIntervalState).toBeNull();
	});

	it("parses explicit fail-closed order conflicts", () => {
		const raw = workspace([
			recordingPart({
				part_id: partA,
				source_id: sourceA,
				ordinal: 0,
				session_offset_seconds: 60,
				effective_start_seconds: 60,
				effective_end_seconds: 90,
			}),
			recordingPart({
				part_id: partB,
				source_id: sourceB,
				ordinal: 1,
				session_offset_seconds: 0,
				effective_start_seconds: 0,
				effective_end_seconds: 30,
				relation_to_previous: "order_conflict",
				relation_seconds: null,
				physical_interval_state: "manual",
			}),
		]);
		raw.timeline.state = "order_conflict";
		(raw.timeline as Record<string, unknown>).order_conflict_count = 1;

		const parsed = parseSessionWorkspace(raw);

		expect(parsed.timeline.state).toBe("order_conflict");
		expect(parsed.parts[1].relationToPrevious).toBe("order_conflict");
		expect(parsed.parts[1].relationSeconds).toBeNull();
		expect(parsed.timeline.orderConflictCount).toBe(1);
	});

	it("rejects duplicate sources, non-contiguous order and invalid clock confidence", () => {
		const duplicate = workspace([
			recordingPart({ part_id: partA, ordinal: 0 }),
			recordingPart({ part_id: partB, ordinal: 1 }),
		]);
		expect(() => parseSessionWorkspace(duplicate)).toThrow();

		const gap = workspace([recordingPart({ ordinal: 1 })]);
		expect(() => parseSessionWorkspace(gap)).toThrow();

		const badClock = workspace([
			recordingPart({ source_start_confidence: "probably_fine" }),
		]);
		expect(() => parseSessionWorkspace(badClock)).toThrow();
	});

	it("rejects unknown relations and incoherent relation counters", () => {
		const conflicted = workspace([
			recordingPart(),
			recordingPart({
				part_id: partB,
				source_id: sourceB,
				ordinal: 1,
				session_offset_seconds: 0,
				effective_start_seconds: 0,
				effective_end_seconds: 30,
				relation_to_previous: "order_conflict",
				relation_seconds: null,
			}),
		]);
		conflicted.timeline.state = "order_conflict";
		conflicted.timeline.automatic_order_available = false;
		(conflicted.timeline as Record<string, unknown>).order_conflict_count = 1;

		const unknown = structuredClone(conflicted);
		unknown.parts[1].relation_to_previous = "timey_wimey";
		expect(() => parseSessionWorkspace(unknown)).toThrow();

		const badCount = structuredClone(conflicted);
		(badCount.timeline as Record<string, unknown>).order_conflict_count = 0;
		expect(() => parseSessionWorkspace(badCount)).toThrow();

		const badGapCount = workspace([
			recordingPart(),
			recordingPart({
				part_id: partB,
				source_id: sourceB,
				ordinal: 1,
				session_offset_seconds: 3601,
				effective_start_seconds: 3601,
				effective_end_seconds: 7201,
				relation_to_previous: "gap",
				relation_seconds: 1,
				physical_interval_state: "manual",
				gap_confirmed: true,
			}),
		]);
		badGapCount.timeline.gap_count = 0;
		expect(() => parseSessionWorkspace(badGapCount)).toThrow();
	});

	it("parses participant reconciliation and rejects inferred profiles", () => {
		const observationId = "3".repeat(32);
		const participantId = "4".repeat(32);
		const base = {
			schema_version: "tda_session_participant_mapping_v1",
			policy: "strong_discord_or_manual_v1",
			campaign_id: "yuhara-main",
			session_id: "session-42",
			workspace_revision: 3,
			mapping_sha256: "a".repeat(64),
			approval_blocked: false,
			observations: [
				{
					observation_id: observationId,
					part_id: partA,
					source_id: sourceA,
					part_ordinal: 0,
					track_number: 1,
					raw_speaker: "Renan",
					username: "Renan",
					discriminator: null,
					discord_id: "111",
				},
			],
			participants: [
				{
					participant_id: participantId,
					resolution: "discord_id",
					profile_id: null,
					display_speaker: "Renan",
					observation_ids: [observationId],
				},
			],
			conflicts: [],
			manual_assignments: [],
		};
		const parsed = parseSessionParticipantMapping(base);
		expect(parsed).toMatchObject({
			schemaVersion: "tda_session_participant_mapping_v1",
			policy: "strong_discord_or_manual_v1",
			mappingSha256: "a".repeat(64),
			approvalBlocked: false,
			participants: [
				{
					participantId,
					resolution: "discord_id",
					profileId: null,
				},
			],
		});
		expect(() =>
			parseSessionParticipantMapping({
				...base,
				participants: [
					{
						...base.participants[0],
						profile_id: "inferred-by-name",
					},
				],
			}),
		).toThrow();
	});

	it("bounds collections and validates deterministic timeline metadata", () => {
		const oversized = workspace(
			Array.from({ length: 65 }, (_, index) =>
				recordingPart({
					part_id: index.toString(16).padStart(32, "0"),
					source_id: `craig-${(index + 1).toString(16).padStart(64, "0")}`,
					ordinal: index,
				}),
			),
		);
		expect(() => parseSessionWorkspace(oversized)).toThrow();

		const badFingerprint = workspace();
		badFingerprint.timeline.fingerprint_sha256 = "not-a-sha";
		expect(() => parseSessionWorkspace(badFingerprint)).toThrow();
	});
});

describe("session transcription intent protocol", () => {
	it("parses local-only text with browser-safe hashes", () => {
		const parsed = parseSessionTranscriptionIntent({
			schema_version: "tda_session_transcription_intent_v1",
			campaign_id: "yuhara-main",
			session_id: "session-42",
			request_id: "intent-42",
			profile_id: "qwen-quality",
			context: "mesa de quinta",
			glossary: "Yuhara",
			context_sha256: "a".repeat(64),
			glossary_sha256: "b".repeat(64),
			created_at: "2026-09-30T01:00:00Z",
			updated_at: "2026-09-30T01:01:00Z",
		});
		expect(parsed).toMatchObject({
			requestId: "intent-42",
			profileId: "qwen-quality",
			context: "mesa de quinta",
			glossary: "Yuhara",
			contextSha256: "a".repeat(64),
			glossarySha256: "b".repeat(64),
		});
	});

	it("fails closed on malformed intent hashes and oversized text", () => {
		const base = {
			schema_version: "tda_session_transcription_intent_v1",
			campaign_id: "yuhara-main",
			session_id: "session-42",
			request_id: "intent-42",
			profile_id: "qwen-quality",
			context: "",
			glossary: "",
			context_sha256: "a".repeat(64),
			glossary_sha256: "b".repeat(64),
			created_at: "2026-09-30T01:00:00Z",
			updated_at: "2026-09-30T01:01:00Z",
		};
		expect(() =>
			parseSessionTranscriptionIntent({ ...base, context_sha256: "bad" }),
		).toThrow();
		expect(() =>
			parseSessionTranscriptionIntent({ ...base, context: "x".repeat(1201) }),
		).toThrow();
	});
});

describe("session workspace bridge", () => {
	it("uses fixed loopback routes and CAS payloads for chronology", async () => {
		let current = workspace([]);
		const request = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
			const body =
				typeof init?.body === "string"
					? (JSON.parse(init.body) as Record<string, unknown>)
					: null;
			if (body && "source_id" in body) {
				current = workspace([
					recordingPart({
						source_id: String(body.source_id),
					}),
				]);
			}
			if (body && Array.isArray(body.part_ids)) {
				current = workspace([
					recordingPart({
						part_id: String(body.part_ids[0]),
						source_id: sourceB,
					}),
					recordingPart({
						part_id: String(body.part_ids[1]),
						source_id: sourceA,
						ordinal: 1,
						relation_to_previous: "contiguous",
						physical_interval_state: "manual",
					}),
				]);
			}
			return Response.json(current);
		});
		const bridge = new LocalBridge(request);
		bridge.pair(token);

		await bridge.ensureSessionWorkspace("yuhara-main", "session-42", signal());
		await bridge.attachSessionSource(
			"yuhara-main",
			"session-42",
			sourceA,
			0,
			signal(),
		);
		await bridge.resetSessionWorkspace(
			"yuhara-main",
			"session-42",
			1,
			signal(),
		);
		await bridge.reorderSessionParts(
			"yuhara-main",
			"session-42",
			[partB, partA],
			1,
			signal(),
		);
		await bridge.deriveSessionTimeline(
			"yuhara-main",
			"session-42",
			2,
			signal(),
		);
		await bridge.updateSessionPartTiming(
			"yuhara-main",
			"session-42",
			{
				partId: partA,
				expectedRevision: 3,
				sessionOffsetSeconds: 120,
				trimStartSeconds: 5,
				trimEndSeconds: 60,
				gapConfirmed: true,
				overlapResolution: "prefer_later_from",
				overlapBoundarySeconds: 125,
			},
			signal(),
		);
		await bridge.detachSessionPart(
			"yuhara-main",
			"session-42",
			partA,
			4,
			signal(),
		);

		expect(request.mock.calls.map(([url]) => String(url))).toEqual([
			`${LOCAL_API}/session-workspaces/yuhara-main/session-42`,
			`${LOCAL_API}/session-workspaces/yuhara-main/session-42/parts`,
			`${LOCAL_API}/session-workspaces/yuhara-main/session-42/reset`,
			`${LOCAL_API}/session-workspaces/yuhara-main/session-42/parts/reorder`,
			`${LOCAL_API}/session-workspaces/yuhara-main/session-42/timeline/derive`,
			`${LOCAL_API}/session-workspaces/yuhara-main/session-42/parts/timing`,
			`${LOCAL_API}/session-workspaces/yuhara-main/session-42/parts/detach`,
		]);
		expect(JSON.parse(String(request.mock.calls[2][1]?.body))).toEqual({
			expected_revision: 1,
		});
		expect(JSON.parse(String(request.mock.calls[4][1]?.body))).toEqual({
			expected_revision: 2,
		});
		expect(JSON.parse(String(request.mock.calls[5][1]?.body))).toEqual({
			part_id: partA,
			expected_revision: 3,
			session_offset_seconds: 120,
			trim_start_seconds: 5,
			trim_end_seconds: 60,
			gap_confirmed: true,
			overlap_resolution: "prefer_later_from",
			overlap_boundary_seconds: 125,
		});
		for (const [, init] of request.mock.calls) {
			expect(init?.headers).toMatchObject({
				Authorization: `Bearer ${token}`,
			});
		}
		bridge.disconnect();
	});

	it("stores and recovers session intent text through the authenticated loopback only", async () => {
		const intent = {
			schema_version: "tda_session_transcription_intent_v1",
			campaign_id: "yuhara-main",
			session_id: "session-42",
			request_id: "intent-42",
			profile_id: "qwen-quality",
			context: "mesa de quinta",
			glossary: "Yuhara",
			context_sha256: "a".repeat(64),
			glossary_sha256: "b".repeat(64),
			created_at: "2026-09-30T01:00:00Z",
			updated_at: "2026-09-30T01:01:00Z",
		};
		const request = vi.fn<typeof fetch>().mockImplementation(async () =>
			Response.json(intent),
		);
		const bridge = new LocalBridge(request);
		bridge.pair(token);

		const saved = await bridge.saveSessionTranscriptionIntent(
			"yuhara-main",
			"session-42",
			{
				requestId: "intent-42",
				profileId: "qwen-quality",
				context: "mesa de quinta",
				glossary: "Yuhara",
			},
			signal(),
		);
		const recovered = await bridge.sessionTranscriptionIntent(
			"yuhara-main",
			"session-42",
			signal(),
		);

		expect(saved.contextSha256).toBe("a".repeat(64));
		expect(recovered.context).toBe("mesa de quinta");
		expect(request.mock.calls.map(([url]) => String(url))).toEqual([
			`${LOCAL_API}/session-workspaces/yuhara-main/session-42/intent`,
			`${LOCAL_API}/session-workspaces/yuhara-main/session-42/intent`,
		]);
		expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({
			request_id: "intent-42",
			profile_id: "qwen-quality",
			context: "mesa de quinta",
			glossary: "Yuhara",
		});
		expect(request.mock.calls[1][1]?.method).toBe("GET");
		bridge.disconnect();
	});

	it("uses fixed participant routes and full-replacement CAS assignments", async () => {
		const observationId = "3".repeat(32);
		const participantId = "4".repeat(32);
		const mapping = {
			schema_version: "tda_session_participant_mapping_v1",
			policy: "strong_discord_or_manual_v1",
			campaign_id: "yuhara-main",
			session_id: "session-42",
			workspace_revision: 2,
			mapping_sha256: "b".repeat(64),
			approval_blocked: false,
			observations: [
				{
					observation_id: observationId,
					part_id: partA,
					source_id: sourceA,
					part_ordinal: 0,
					track_number: 1,
					raw_speaker: "Guest",
					username: "Guest",
					discriminator: null,
					discord_id: null,
				},
			],
			participants: [
				{
					participant_id: participantId,
					resolution: "manual",
					profile_id: null,
					display_speaker: "Guest",
					observation_ids: [observationId],
				},
			],
			conflicts: [],
			manual_assignments: [
				{
					observation_id: observationId,
					participant_id: participantId,
				},
			],
		};
		const request = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(mapping));
		const bridge = new LocalBridge(request);
		bridge.pair(token);

		await bridge.sessionParticipants("yuhara-main", "session-42", signal());
		const updated = await bridge.updateSessionParticipants(
			"yuhara-main",
			"session-42",
			1,
			[{ observationId, participantId }],
			signal(),
		);

		expect(updated.participants[0]?.profileId).toBeNull();
		expect(request.mock.calls.map(([url]) => String(url))).toEqual([
			`${LOCAL_API}/session-workspaces/yuhara-main/session-42/participants`,
			`${LOCAL_API}/session-workspaces/yuhara-main/session-42/participants`,
		]);
		expect(request.mock.calls[0][1]?.method).toBe("GET");
		expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toEqual({
			expected_revision: 1,
			assignments: [
				{
					observation_id: observationId,
					participant_id: participantId,
				},
			],
		});
		bridge.disconnect();
	});
});
