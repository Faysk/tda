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

type RawWorkspacePart = {
	part_id: string;
	source_id: string;
	ordinal: number;
	selected_run_id: null;
	source_state: string;
	manual_offset_seconds?: number | null;
	trim_start_seconds?: number;
	trim_end_seconds?: number | null;
	created_at: string;
	updated_at: string;
};

function workspace(parts: RawWorkspacePart[] = [
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

	it("parses bounded chronology and keeps older workspace responses compatible", () => {
		const raw = workspace([
			{
				...workspace().parts[0],
				manual_offset_seconds: 0,
				trim_start_seconds: 0,
				trim_end_seconds: null,
			},
			{
				...workspace().parts[0],
				part_id: partB,
				source_id: sourceB,
				ordinal: 1,
				manual_offset_seconds: 60,
				trim_start_seconds: 0,
				trim_end_seconds: null,
			},
		]);
		Object.assign(raw, {
			order_authority: "manual",
			timeline: {
				schema_version: "tda_session_timeline_v1",
				config_sha256: "a".repeat(64),
				ready: true,
				order: {
					state: "manual",
					workspace_authority: "manual",
					suggested_part_ids: null,
					matches_suggestion: null,
				},
				parts: [
					{
						part_id: partA,
						source_id: sourceA,
						ordinal: 0,
						source_start: {
							confidence: "missing",
							raw: null,
							instant_utc: null,
						},
						duration_seconds: 60,
						manual_offset_seconds: 0,
						session_offset_seconds: 0,
						placement_authority: "manual",
						trim_start_seconds: 0,
						trim_end_seconds: null,
						effective_start_seconds: 0,
						effective_end_seconds: 60,
						state: "ready",
					},
					{
						part_id: partB,
						source_id: sourceB,
						ordinal: 1,
						source_start: {
							confidence: "missing",
							raw: null,
							instant_utc: null,
						},
						duration_seconds: 30,
						manual_offset_seconds: 60,
						session_offset_seconds: 60,
						placement_authority: "manual",
						trim_start_seconds: 0,
						trim_end_seconds: null,
						effective_start_seconds: 60,
						effective_end_seconds: 90,
						state: "ready",
					},
				],
				relations: [
					{
						earlier_part_id: partA,
						later_part_id: partB,
						kind: "contiguous",
						duration_seconds: 0,
						decision: null,
						boundary_seconds: null,
						resolved: true,
					},
				],
			},
		});

		const parsed = parseSessionWorkspace(raw);
		expect(parsed.orderAuthority).toBe("manual");
		expect(parsed.parts[1]).toMatchObject({
			manualOffsetSeconds: 60,
			trimStartSeconds: 0,
			trimEndSeconds: null,
		});
		expect(parsed.timeline).toMatchObject({
			schemaVersion: "tda_session_timeline_v1",
			configSha256: "a".repeat(64),
			ready: true,
			order: { state: "manual", workspaceAuthority: "manual" },
			relations: [{ kind: "contiguous", resolved: true }],
		});

		const legacy = parseSessionWorkspace(workspace());
		expect(legacy.orderAuthority).toBe("unconfirmed");
		expect(legacy.timeline).toBeNull();
		expect(legacy.parts[0]).toMatchObject({
			manualOffsetSeconds: null,
			trimStartSeconds: 0,
			trimEndSeconds: null,
		});
	});

	it("rejects chronology that points relations at non-adjacent parts", () => {
		const raw = workspace([
			workspace().parts[0],
			{
				...workspace().parts[0],
				part_id: partB,
				source_id: sourceB,
				ordinal: 1,
			},
		]);
		Object.assign(raw, {
			timeline: {
				schema_version: "tda_session_timeline_v1",
				config_sha256: "b".repeat(64),
				ready: false,
				order: {
					state: "manual_required",
					workspace_authority: "unconfirmed",
					suggested_part_ids: null,
					matches_suggestion: null,
				},
				parts: [partA, partB].map((partId, ordinal) => ({
					part_id: partId,
					source_id: ordinal === 0 ? sourceA : sourceB,
					ordinal,
					source_start: { confidence: "missing", raw: null, instant_utc: null },
					duration_seconds: null,
					manual_offset_seconds: null,
					session_offset_seconds: null,
					placement_authority: "unresolved",
					trim_start_seconds: 0,
					trim_end_seconds: null,
					effective_start_seconds: null,
					effective_end_seconds: null,
					state: "unresolved",
				})),
				relations: [
					{
						earlier_part_id: partB,
						later_part_id: partA,
						kind: "unknown",
						duration_seconds: null,
						decision: null,
						boundary_seconds: null,
						resolved: false,
					},
				],
			},
		});
		expect(() => parseSessionWorkspace(raw)).toThrow();
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
		await bridge.updateSessionPartTiming(
			"yuhara-main",
			"session-42",
			partB,
			{
				manualOffsetSeconds: 30,
				trimStartSeconds: 2,
				trimEndSeconds: 45,
			},
			2,
			signal(),
		);
		await bridge.resolveSessionTimeline(
			"yuhara-main",
			"session-42",
			partB,
			partA,
			{ decision: "prefer_later_from", boundarySeconds: 35 },
			3,
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
			`${LOCAL_API}/session-workspaces/yuhara-main/session-42/parts/reorder`,
			`${LOCAL_API}/session-workspaces/yuhara-main/session-42/parts/timing`,
			`${LOCAL_API}/session-workspaces/yuhara-main/session-42/timeline/resolve`,
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
			manual_offset_seconds: 30,
			trim_start_seconds: 2,
			trim_end_seconds: 45,
			expected_revision: 2,
		});
		expect(JSON.parse(String(request.mock.calls[4][1]?.body))).toEqual({
			earlier_part_id: partB,
			later_part_id: partA,
			decision: "prefer_later_from",
			boundary_seconds: 35,
			expected_revision: 3,
		});
		expect(JSON.parse(String(request.mock.calls[5][1]?.body))).toEqual({
			part_id: partA,
			expected_revision: 4,
		});
		for (const [, init] of request.mock.calls) {
			expect(init?.headers).toMatchObject({
				Authorization: `Bearer ${token}`,
			});
		}
		bridge.disconnect();
	});
});
