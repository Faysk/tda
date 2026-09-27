import { describe, expect, it } from "vitest";
import { parseJob } from "./protocol";

const baseJob = {
	id: "job-1",
	kind: "transcription.craig",
	status: "running",
	stage: "transcription",
	progress: { completed: 1, total: 3, unit: "tracks" },
	error: null,
	result_available: false,
	updated_at: "2026-09-27T10:00:10Z",
	attempt: 2,
	context: {
		campaign_id: "campaign",
		session_id: "session",
		source_id: "source",
		profile_id: "qwen-fast",
	},
};

describe("authoritative job timing", () => {
	it("parses persisted attempt stage and track clocks", () => {
		expect(
			parseJob({
				...baseJob,
				timing: {
					attempt_started_at: "2026-09-27T09:50:00Z",
					stage_started_at: "2026-09-27T09:58:00Z",
					current_track: 2,
					track_started_at: "2026-09-27T09:59:00Z",
				},
			}).timing,
		).toEqual({
			attemptStartedAt: "2026-09-27T09:50:00Z",
			stageStartedAt: "2026-09-27T09:58:00Z",
			currentTrack: 2,
			trackStartedAt: "2026-09-27T09:59:00Z",
		});
	});

	it("keeps legacy jobs readable without inventing clocks", () => {
		expect(parseJob(baseJob).timing).toEqual({
			attemptStartedAt: null,
			stageStartedAt: null,
			currentTrack: null,
			trackStartedAt: null,
		});
	});

	it("rejects half-defined track timing", () => {
		expect(() =>
			parseJob({
				...baseJob,
				timing: {
					attempt_started_at: "2026-09-27T09:50:00Z",
					stage_started_at: "2026-09-27T09:58:00Z",
					current_track: 2,
					track_started_at: null,
				},
			}),
		).toThrow();
	});
});
