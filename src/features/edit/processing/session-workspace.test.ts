import { describe, expect, it, vi } from "vitest";
import { LocalBridge } from "./bridge";
import {
	LOCAL_API,
	parseSessionTimeline,
	parseSessionWorkspace,
} from "./protocol";

const signal = () => new AbortController().signal;
const token = "synthetic_test_token_12345678901234567890";
const sourceA = `craig-${"a".repeat(64)}`;
const sourceB = `craig-${"b".repeat(64)}`;
const partA = "1".repeat(32);
const partB = "2".repeat(32);

function workspace(parts = [
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

	it("parses the bounded versioned timeline contract", () => {
		const parsed = parseSessionTimeline({
			schema_version: "tda_session_timeline_v1",
			campaign_id: "yuhara-main",
			session_id: "session-42",
			workspace_revision: 4,
			chronology_mode: "manual",
			segment_boundary_policy: "segment_start_v1",
			overlap_policy: "split_boundary_v1",
			configuration_sha256: "c".repeat(64),
			approval_blocked: false,
			parts: [
				{
					part_id: partA,
					source_id: sourceA,
					workspace_ordinal: 0,
					timeline_ordinal: 0,
					source_state: "ready",
					start_time: {
						classification: "trusted_absolute",
						raw: "2026-09-27T20:00:00Z",
						epoch_seconds: 1790539200,
					},
					duration_seconds: 120,
					manual_offset_seconds: 0,
					trim_start_seconds: null,
					trim_end_seconds: null,
					gap_confirmed: false,
					overlap_boundary_seconds: null,
					configuration_valid: true,
					placement_authority: "manual",
					session_offset_seconds: 0,
					effective_start_seconds: 0,
					effective_end_seconds: 120,
				},
				{
					part_id: partB,
					source_id: sourceB,
					workspace_ordinal: 1,
					timeline_ordinal: 1,
					source_state: "ready",
					start_time: {
						classification: "ambiguous",
						raw: "2026-09-27T20:01:30",
						epoch_seconds: null,
					},
					duration_seconds: 120,
					manual_offset_seconds: 90,
					trim_start_seconds: null,
					trim_end_seconds: null,
					gap_confirmed: false,
					overlap_boundary_seconds: 105,
					configuration_valid: true,
					placement_authority: "manual",
					session_offset_seconds: 90,
					effective_start_seconds: 90,
					effective_end_seconds: 210,
				},
			],
			relations: [
				{
					earlier_part_id: partA,
					later_part_id: partB,
					kind: "overlap",
					seconds: 30,
					resolved: true,
					resolution: "split_boundary_v1",
					boundary_seconds: 105,
				},
			],
		});
		expect(parsed).toMatchObject({
			schemaVersion: "tda_session_timeline_v1",
			chronologyMode: "manual",
			configurationSha256: "c".repeat(64),
			approvalBlocked: false,
			parts: [
				{ partId: partA, placementAuthority: "manual", sessionOffsetSeconds: 0 },
				{ partId: partB, placementAuthority: "manual", sessionOffsetSeconds: 90 },
			],
			relations: [
				{
					kind: "overlap",
					resolved: true,
					boundarySeconds: 105,
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
		await bridge.detachSessionPart(
			"yuhara-main",
			"session-42",
			partA,
			2,
			signal(),
		);

		expect(request.mock.calls.map(([url]) => String(url))).toEqual([
			`${LOCAL_API}/session-workspaces/yuhara-main/session-42`,
			`${LOCAL_API}/session-workspaces/yuhara-main/session-42/parts`,
			`${LOCAL_API}/session-workspaces/yuhara-main/session-42/parts/reorder`,
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
			part_id: partA,
			expected_revision: 2,
		});
		for (const [, init] of request.mock.calls) {
			expect(init?.headers).toMatchObject({
				Authorization: `Bearer ${token}`,
			});
		}
		bridge.disconnect();
	});

	it("uses fixed timeline routes and serializes the full CAS timing decision", async () => {
		const timeline = {
			schema_version: "tda_session_timeline_v1",
			campaign_id: "yuhara-main",
			session_id: "session-42",
			workspace_revision: 3,
			chronology_mode: "manual",
			segment_boundary_policy: "segment_start_v1",
			overlap_policy: "split_boundary_v1",
			configuration_sha256: "d".repeat(64),
			approval_blocked: false,
			parts: [],
			relations: [],
		};
		const timedWorkspace = {
			...workspace(),
			revision: 3,
			chronology_mode: "manual",
			parts: [
				{
					...workspace().parts[0],
					manual_offset_seconds: 90,
					trim_start_seconds: 1,
					trim_end_seconds: 119,
					gap_confirmed: true,
					overlap_boundary_seconds: 105,
				},
			],
		};
		const request = vi.fn<typeof fetch>().mockImplementation(async (url) =>
			Response.json(
				String(url).endsWith("/timeline") ? timeline : timedWorkspace,
			),
		);
		const bridge = new LocalBridge(request);
		bridge.pair(token);

		const parsedTimeline = await bridge.sessionTimeline(
			"yuhara-main",
			"session-42",
			signal(),
		);
		const updated = await bridge.updateSessionPartTiming(
			"yuhara-main",
			"session-42",
			partA,
			2,
			{
				manualOffsetSeconds: 90,
				trimStartSeconds: 1,
				trimEndSeconds: 119,
				gapConfirmed: true,
				overlapBoundarySeconds: 105,
			},
			signal(),
		);

		expect(parsedTimeline.configurationSha256).toBe("d".repeat(64));
		expect(updated.chronologyMode).toBe("manual");
		expect(request.mock.calls.map(([url]) => String(url))).toEqual([
			`${LOCAL_API}/session-workspaces/yuhara-main/session-42/timeline`,
			`${LOCAL_API}/session-workspaces/yuhara-main/session-42/parts/timing`,
		]);
		expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toEqual({
			part_id: partA,
			expected_revision: 2,
			manual_offset_seconds: 90,
			trim_start_seconds: 1,
			trim_end_seconds: 119,
			gap_confirmed: true,
			overlap_boundary_seconds: 105,
		});
		bridge.disconnect();
	});
});
