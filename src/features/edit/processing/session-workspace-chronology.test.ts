import { describe, expect, it } from "vitest";
import { parseSessionWorkspace } from "./protocol";

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
		session_offset_seconds: 60,
		trim_start_seconds: 0,
		trim_end_seconds: null,
		gap_confirmed: false,
		overlap_resolution: null,
		overlap_boundary_seconds: null,
		source_start_time: "2026-09-27T20:01:00Z",
		source_start_confidence: "trusted_absolute",
		source_start_utc: "2026-09-27T20:01:00Z",
		source_duration_seconds: 30,
		effective_start_seconds: 60,
		effective_end_seconds: 90,
		relation_to_previous: "first",
		relation_seconds: 0,
		overlap_resolution_valid: false,
		created_at: "2026-09-27T22:30:00Z",
		updated_at: "2026-09-27T22:30:00Z",
		...overrides,
	};
}

function orderConflictWorkspace() {
	return {
		schema_version: "tda_session_workspace_v1",
		campaign_id: "yuhara-main",
		session_id: "session-42",
		revision: 2,
		ordering_mode: "manual",
		created_at: "2026-09-27T22:30:00Z",
		updated_at: "2026-09-27T22:31:00Z",
		parts: [
			recordingPart(),
			recordingPart({
				part_id: partB,
				source_id: sourceB,
				ordinal: 1,
				session_offset_seconds: 0,
				source_start_time: "2026-09-27T20:00:00Z",
				source_start_utc: "2026-09-27T20:00:00Z",
				effective_start_seconds: 0,
				effective_end_seconds: 30,
				relation_to_previous: "order_conflict",
				relation_seconds: null,
			}),
		],
		timeline: {
			policy_version: "tda_session_timeline_v1",
			segment_boundary_policy: "segment_start_owner_v1",
			fingerprint_sha256: "f".repeat(64),
			state: "order_conflict",
			all_sources_trusted: true,
			automatic_order_available: true,
			gap_count: 0,
			overlap_count: 0,
			order_conflict_count: 1,
			unresolved_overlap_count: 0,
			unconfirmed_gap_count: 0,
		},
	};
}

describe("session workspace chronology protocol", () => {
	it("accepts the explicit fail-closed order-conflict relation", () => {
		const parsed = parseSessionWorkspace(orderConflictWorkspace());

		expect(parsed.timeline.state).toBe("order_conflict");
		expect(parsed.timeline.orderConflictCount).toBe(1);
		expect(parsed.parts[1]?.relationToPrevious).toBe("order_conflict");
		expect(parsed.parts[1]?.relationSeconds).toBeNull();
	});

	it("rejects unknown relation kinds", () => {
		const raw = orderConflictWorkspace();
		raw.parts[1].relation_to_previous = "identifier_tiebreak";

		expect(() => parseSessionWorkspace(raw)).toThrow();
	});

	it("rejects malformed or contradictory relation counts", () => {
		const negative = orderConflictWorkspace();
		negative.timeline.order_conflict_count = -1;
		expect(() => parseSessionWorkspace(negative)).toThrow();

		const contradictory = orderConflictWorkspace();
		contradictory.timeline.order_conflict_count = 0;
		expect(() => parseSessionWorkspace(contradictory)).toThrow();
	});
});
