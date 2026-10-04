import { describe, expect, it, vi } from "vitest";
import {
	logSessionCampaignMoveTelemetry,
	sessionCampaignMoveTelemetryEvent,
} from "./session-campaign-move-telemetry";

describe("session campaign move telemetry", () => {
	it("contains only bounded operational metadata", () => {
		const event = sessionCampaignMoveTelemetryEvent({
			stage: "prepare",
			outcome: "prepared",
			preparedAssets: 2,
		});
		expect(event).toEqual({
			schema: "tda.session-campaign-move.v1",
			event: "session_campaign_move",
			stage: "prepare",
			outcome: "prepared",
			contractVersion: 2,
			preparedAssets: 2,
		});
		expect(JSON.stringify(event)).not.toContain("sessionId");
		expect(JSON.stringify(event)).not.toContain("campaign");
		expect(JSON.stringify(event)).not.toContain("actor");
	});

	it("writes a single structured line", () => {
		const spy = vi.spyOn(console, "info").mockImplementation(() => {});
		logSessionCampaignMoveTelemetry({
			stage: "commit",
			outcome: "replay",
		});
		expect(spy).toHaveBeenCalledTimes(1);
		expect(JSON.parse(String(spy.mock.calls[0]?.[0]))).toMatchObject({
			event: "session_campaign_move",
			stage: "commit",
			outcome: "replay",
			contractVersion: 2,
		});
		spy.mockRestore();
	});
});
