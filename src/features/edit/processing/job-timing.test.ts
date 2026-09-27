import { expect, it } from "vitest";
import { parseJob } from "./protocol";

const baseJob = {
	id: "job-1",
	kind: "transcription.craig",
	status: "running",
	stage: "transcription",
	progress: { completed: 0, total: 2, unit: "tracks" },
	error: null,
	result_available: false,
	updated_at: "2026-09-27T01:00:10.000Z",
	attempt: 2,
	context: {
		campaign_id: "campaign",
		session_id: "session",
		source_id: "source",
		profile_id: "qwen-fast",
	},
	execution_device: null,
	timing: {
		schema_version: "tda_job_timing_v1",
		attempt_started_at: "2026-09-27T01:00:00.000Z",
		attempt_finished_at: null,
		attempt_elapsed_seconds: 10,
		stage_started_at: "2026-09-27T01:00:04.000Z",
		stage_elapsed_seconds: 6,
		tracks: [
			{
				track: 1,
				total_tracks: 2,
				speaker: "Speaker A",
				started_at: "2026-09-27T01:00:05.000Z",
				finished_at: null,
				processing_seconds: null,
			},
		],
	},
};

it("parses authoritative attempt, stage and track timing", () => {
	const job = parseJob(baseJob);
	expect(job.timing).toEqual({
		schemaVersion: "tda_job_timing_v1",
		attemptStartedAt: "2026-09-27T01:00:00.000Z",
		attemptFinishedAt: null,
		attemptElapsedSeconds: 10,
		stageStartedAt: "2026-09-27T01:00:04.000Z",
		stageElapsedSeconds: 6,
		tracks: [
			{
				track: 1,
				totalTracks: 2,
				speaker: "Speaker A",
				startedAt: "2026-09-27T01:00:05.000Z",
				finishedAt: null,
				processingSeconds: null,
			},
		],
	});
});

it("rejects malformed timing instead of inventing elapsed time", () => {
	expect(() =>
		parseJob({
			...baseJob,
			timing: { ...baseJob.timing, attempt_elapsed_seconds: -1 },
		}),
	).toThrow();
	expect(() =>
		parseJob({
			...baseJob,
			timing: {
				...baseJob.timing,
				tracks: [
					...baseJob.timing.tracks,
					{ ...baseJob.timing.tracks[0], speaker: "duplicate" },
				],
			},
		}),
	).toThrow();
	expect(() =>
		parseJob({
			...baseJob,
			timing: { ...baseJob.timing, schema_version: "unknown" },
		}),
	).toThrow();
});
