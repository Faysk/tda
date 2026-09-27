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
	const timelineParts = parts.map((part, index) => ({
		part_id: part.part_id,
		source_id: part.source_id,
		ordinal: index,
		start_time: {
			raw: null,
			confidence: "missing",
			normalized_utc: null,
		},
		source_duration_ms: 60_000,
		placement: {
			session_offset_ms: index * 60_000,
			origin: parts.length === 1 ? "single_source_zero" : "manual",
			trim_start_ms: 0,
			trim_end_ms: null,
		},
		effective_start_ms: index * 60_000,
		effective_end_ms: (index + 1) * 60_000,
		suggested_ordinal: null,
		order_matches_trusted_suggestion: null,
	}));
	return {
		schema_version: "tda_session_workspace_v1",
		campaign_id: "yuhara-main",
		session_id: "session-42",
		revision: parts.length,
		created_at: "2026-09-27T22:30:00Z",
		updated_at: "2026-09-27T22:31:00Z",
		parts,
		timeline: {
			schema_version: "tda_session_timeline_v1",
			segment_boundary_policy: "segment_start_v1",
			configuration_sha256: "c".repeat(64),
			timeline_identity_sha256: "d".repeat(64),
			approval_ready: true,
			order_matches_trusted_suggestion: null,
			parts: timelineParts,
			boundaries: timelineParts.slice(0, -1).map((part, index) => ({
				left_part_id: part.part_id,
				right_part_id: timelineParts[index + 1].part_id,
				kind: "contiguous",
				duration_ms: 0,
				resolved: true,
				resolution: null,
			})),
		},
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
			timeline: {
				schemaVersion: "tda_session_timeline_v1",
				segmentBoundaryPolicy: "segment_start_v1",
				approvalReady: true,
			},
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
});


describe("session timeline bridge", () => {
	it("serializes explicit offsets, trims and boundary decisions with CAS", async () => {
		const current = workspace([
			{ ...workspace().parts[0], part_id: partA, source_id: sourceA, ordinal: 0 },
			{ ...workspace().parts[0], part_id: partB, source_id: sourceB, ordinal: 1 },
		]);
		const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(current));
		const bridge = new LocalBridge(request);
		bridge.pair(token);

		const parsed = await bridge.updateSessionTimeline(
			"yuhara-main",
			"session-42",
			{
				expectedRevision: 2,
				parts: [
					{
						partId: partA,
						sessionOffsetMs: 0,
						trimStartMs: 0,
						trimEndMs: 45_000,
					},
					{
						partId: partB,
						sessionOffsetMs: 30_000,
						trimStartMs: 0,
						trimEndMs: null,
					},
				],
				boundaries: [
					{
						leftPartId: partA,
						rightPartId: partB,
						mode: "prefer_earlier_until",
						boundaryMs: 30_000,
					},
				],
			},
			signal(),
		);

		expect(parsed.timeline.timelineIdentitySha256).toBe("d".repeat(64));
		expect(request).toHaveBeenCalledTimes(1);
		expect(String(request.mock.calls[0][0])).toBe(
			`${LOCAL_API}/session-workspaces/yuhara-main/session-42/timeline`,
		);
		expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({
			expected_revision: 2,
			parts: [
				{
					part_id: partA,
					session_offset_ms: 0,
					trim_start_ms: 0,
					trim_end_ms: 45_000,
				},
				{
					part_id: partB,
					session_offset_ms: 30_000,
					trim_start_ms: 0,
					trim_end_ms: null,
				},
			],
			boundaries: [
				{
					left_part_id: partA,
					right_part_id: partB,
					mode: "prefer_earlier_until",
					boundary_ms: 30_000,
				},
			],
		});
		bridge.disconnect();
	});
});
