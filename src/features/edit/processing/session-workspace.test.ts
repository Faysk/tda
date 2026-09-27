import { describe, expect, it, vi } from "vitest";
import { LocalBridge } from "./bridge";
import {
	LOCAL_API,
	parseSessionWorkspace,
} from "./protocol";

const signal = () => new AbortController().signal;
const token = "synthetic_test_token_12345678901234567890";
const sourceA = `craig-${"a".repeat(64)}`;
const sourceB = `craig-${"b".repeat(64)}`;
const partA = "1".repeat(32);
const partB = "2".repeat(32);

function workspace(parts: Array<Record<string, unknown>> = [
	{
		part_id: partA,
		source_id: sourceA,
		ordinal: 0,
		selected_run_id: null,
		source_state: "ready",
		created_at: "2026-09-27T22:30:00Z",
		updated_at: "2026-09-27T22:30:00Z",
	},
]) {
	return {
		schema_version: "tda_session_workspace_v1",
		campaign_id: "yuhara-main",
		session_id: "session-42",
		revision: parts.length,
		created_at: "2026-09-27T22:30:00Z",
		updated_at: "2026-09-27T22:31:00Z",
		parts,
	};
}

function chronology() {
	return {
		schema_version: "tda_recording_chronology_v1",
		segment_boundary_policy: "segment_start_owner_v1",
		sha256: "c".repeat(64),
		ready_for_assembly: false,
		blocking_reasons: [`OVERLAP_UNRESOLVED:${partB}`],
		parts: [
			{
				part_id: partA,
				source_id: sourceA,
				ordinal: 0,
				start_time_confidence: "trusted_absolute",
				normalized_start_time: "2026-09-27T20:00:00Z",
				placement_authority: "trusted_absolute",
				local_duration_seconds: 90,
				session_offset_seconds: 0,
				trim_start_seconds: 0,
				trim_end_seconds: null,
				effective_start_seconds: 0,
				effective_end_seconds: 90,
			},
			{
				part_id: partB,
				source_id: sourceB,
				ordinal: 1,
				start_time_confidence: "trusted_absolute",
				normalized_start_time: "2026-09-27T20:01:00Z",
				placement_authority: "trusted_absolute",
				local_duration_seconds: 90,
				session_offset_seconds: 60,
				trim_start_seconds: 0,
				trim_end_seconds: null,
				effective_start_seconds: 60,
				effective_end_seconds: 150,
			},
		],
		relations: [
			{
				earlier_part_id: partA,
				later_part_id: partB,
				kind: "overlap",
				seconds: 30,
				confirmed: false,
				overlap_resolution: null,
			},
		],
	};
}

describe("session workspace protocol", () => {
	it("parses only sanitized ordered recording-part metadata", () => {
		const parsed = parseSessionWorkspace(workspace());
		expect(parsed).toMatchObject({
			schemaVersion: "tda_session_workspace_v1",
			campaignId: "yuhara-main",
			sessionId: "session-42",
			revision: 1,
			parts: [
				{
					partId: partA,
					sourceId: sourceA,
					ordinal: 0,
					selectedRunId: null,
					sourceState: "ready",
				},
			],
		});
		expect(JSON.stringify(parsed)).not.toContain("path");
		expect(JSON.stringify(parsed)).not.toContain("transcript");
	});

	it("parses additive chronology while preserving older workspace responses", () => {
		const legacy = parseSessionWorkspace(workspace());
		expect(legacy.chronology).toBeNull();
		expect(legacy.parts[0]).toMatchObject({
			sessionOffsetSeconds: null,
			trimStartSeconds: 0,
			trimEndSeconds: null,
			gapConfirmed: false,
			overlapResolution: null,
			overlapBoundarySeconds: null,
			chronologyVersion: "tda_recording_chronology_v1",
		});

		const raw = workspace([
			{
				...workspace().parts[0],
				part_id: partA,
				source_id: sourceA,
				ordinal: 0,
				session_offset_seconds: 0,
				trim_start_seconds: 0,
				trim_end_seconds: null,
				gap_confirmed: false,
				overlap_resolution: null,
				overlap_boundary_seconds: null,
				chronology_version: "tda_recording_chronology_v1",
			},
			{
				...workspace().parts[0],
				part_id: partB,
				source_id: sourceB,
				ordinal: 1,
				session_offset_seconds: null,
				trim_start_seconds: 0,
				trim_end_seconds: null,
				gap_confirmed: false,
				overlap_resolution: null,
				overlap_boundary_seconds: null,
				chronology_version: "tda_recording_chronology_v1",
			},
		]);
		const parsed = parseSessionWorkspace({ ...raw, chronology: chronology() });
		expect(parsed.chronology).toMatchObject({
			schemaVersion: "tda_recording_chronology_v1",
			segmentBoundaryPolicy: "segment_start_owner_v1",
			sha256: "c".repeat(64),
			readyForAssembly: false,
			blockingReasons: [`OVERLAP_UNRESOLVED:${partB}`],
			relations: [
				{
					kind: "overlap",
					seconds: 30,
					confirmed: false,
				},
			],
		});
	});

	it("rejects duplicate sources, non-contiguous order and oversized collections", () => {
		const duplicate = workspace([
			{
				...workspace().parts[0],
				part_id: partA,
				ordinal: 0,
			},
			{
				...workspace().parts[0],
				part_id: partB,
				ordinal: 1,
			},
		]);
		expect(() => parseSessionWorkspace(duplicate)).toThrow();

		const gap = workspace([
			{
				...workspace().parts[0],
				ordinal: 1,
			},
		]);
		expect(() => parseSessionWorkspace(gap)).toThrow();

		const oversized = workspace(
			Array.from({ length: 65 }, (_, index) => ({
				part_id: index.toString(16).padStart(32, "0"),
				source_id: `craig-${(index + 1).toString(16).padStart(64, "0")}`,
				ordinal: index,
				selected_run_id: null,
				source_state: "ready",
				created_at: "2026-09-27T22:30:00Z",
				updated_at: "2026-09-27T22:30:00Z",
			})),
		);
		expect(() => parseSessionWorkspace(oversized)).toThrow();
	});
});

describe("session workspace bridge", () => {
	it("uses fixed loopback routes and CAS payloads", async () => {
		let current = workspace([]);
		const request = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
			const body =
				typeof init?.body === "string"
					? (JSON.parse(init.body) as Record<string, unknown>)
					: null;
			if (body && "source_id" in body) {
				current = workspace([
					{
						...workspace().parts[0],
						source_id: String(body.source_id),
					},
				]);
			}
			if (body && Array.isArray(body.part_ids)) {
				current = workspace([
					{
						...workspace().parts[0],
						part_id: String(body.part_ids[0]),
						source_id: sourceB,
					},
					{
						...workspace().parts[0],
						part_id: String(body.part_ids[1]),
						source_id: sourceA,
						ordinal: 1,
					},
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
		await bridge.reorderSessionParts(
			"yuhara-main",
			"session-42",
			[partB, partA],
			1,
			signal(),
		);
		await bridge.updateSessionPartTimeline(
			"yuhara-main",
			"session-42",
			partB,
			2,
			{
				sessionOffsetSeconds: 75,
				trimStartSeconds: 5,
				trimEndSeconds: 65,
				gapConfirmed: true,
				overlapResolution: null,
				overlapBoundarySeconds: null,
			},
			signal(),
		);
		await bridge.detachSessionPart(
			"yuhara-main",
			"session-42",
			partA,
			3,
			signal(),
		);

		expect(request.mock.calls.map(([url]) => String(url))).toEqual([
			`${LOCAL_API}/session-workspaces/yuhara-main/session-42`,
			`${LOCAL_API}/session-workspaces/yuhara-main/session-42/parts`,
			`${LOCAL_API}/session-workspaces/yuhara-main/session-42/parts/reorder`,
			`${LOCAL_API}/session-workspaces/yuhara-main/session-42/parts/timeline`,
			`${LOCAL_API}/session-workspaces/yuhara-main/session-42/parts/detach`,
		]);
		expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toEqual({
			source_id: sourceA,
			expected_revision: 0,
		});
		expect(JSON.parse(String(request.mock.calls[2][1]?.body))).toEqual({
			part_ids: [partB, partA],
			expected_revision: 1,
		});
		expect(JSON.parse(String(request.mock.calls[3][1]?.body))).toEqual({
			part_id: partB,
			expected_revision: 2,
			session_offset_seconds: 75,
			trim_start_seconds: 5,
			trim_end_seconds: 65,
			gap_confirmed: true,
			overlap_resolution: null,
			overlap_boundary_seconds: null,
		});
		expect(JSON.parse(String(request.mock.calls[4][1]?.body))).toEqual({
			part_id: partA,
			expected_revision: 3,
		});
		for (const [, init] of request.mock.calls) {
			expect(init?.headers).toMatchObject({
				Authorization: `Bearer ${token}`,
			});
		}
		bridge.disconnect();
	});
});
