import { describe, expect, it } from "vitest";
import { createStatisticsReadTelemetry } from "./telemetry";

describe("statistics production telemetry", () => {
	it("counts bounded aggregate cost without retaining private identifiers", () => {
		let now = 100;
		const telemetry = createStatisticsReadTelemetry(() => now);
		const privateSession = "session-private";

		telemetry.request("sessions");
		telemetry.response("sessions", [{ id: privateSession }]);
		telemetry.request("aggregates");
		telemetry.response("aggregates", [
			{
				session_id: privateSession,
				segment_count: 30_857,
				complete_text_count: 30_857,
				word_count: 400_000,
			},
		]);

		now = 137.456;
		const snapshot = telemetry.finish("success");

		expect(snapshot.event).toBe("tda_stats_read_v2");
		expect(snapshot.outcome).toBe("success");
		expect(snapshot.duration_ms).toBeCloseTo(37.46, 2);
		expect(snapshot.session_requests).toBe(1);
		expect(snapshot.aggregate_requests).toBe(1);
		expect(snapshot.session_rows).toBe(1);
		expect(snapshot.aggregate_rows).toBe(1);
		expect(snapshot.payload_bytes_approx).toBeGreaterThan(0);
		expect(JSON.stringify(snapshot)).not.toContain(privateSession);
	});
});
