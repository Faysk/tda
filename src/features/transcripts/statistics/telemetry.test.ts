import { describe, expect, it } from "vitest";
import { createStatisticsReadTelemetry } from "./telemetry";

describe("statistics production telemetry", () => {
	it("counts request cost without retaining private payload content", () => {
		let now = 100;
		const telemetry = createStatisticsReadTelemetry(() => now);
		const privateText = "SEGREDO sintético com ação";

		telemetry.request("sessions");
		telemetry.response("sessions", [{ id: "session-private" }]);
		telemetry.request("segments");
		telemetry.response("segments", [
			{ id: "segment-private", text: privateText },
		]);
		telemetry.request("segments");
		telemetry.response("segments", []);

		now = 137.456;
		const snapshot = telemetry.finish("success");

		expect(snapshot.event).toBe("tda_stats_read_v1");
		expect(snapshot.outcome).toBe("success");
		expect(snapshot.duration_ms).toBeCloseTo(37.46, 2);
		expect(snapshot.session_requests).toBe(1);
		expect(snapshot.segment_requests).toBe(2);
		expect(snapshot.session_rows).toBe(1);
		expect(snapshot.segment_rows).toBe(1);
		expect(snapshot.payload_bytes_approx).toBeGreaterThan(0);
		expect(JSON.stringify(snapshot)).not.toContain(privateText);
		expect(JSON.stringify(snapshot)).not.toContain("session-private");
		expect(JSON.stringify(snapshot)).not.toContain("segment-private");
	});
});
