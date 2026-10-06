import { describe, expect, it } from "vitest";
import {
	jobDiagnosticEventsForAttempt,
	sanitizeJobDiagnosticEvent,
} from "./job-diagnostics-inspector";
import type { JobEvent } from "./protocol";

describe("contextual job diagnostic privacy contract", () => {
	it("keeps only allowlisted operational event metadata", () => {
		const event: JobEvent = {
			seq: 42,
			attempt: 3,
			code: "QWEN_ALIGNMENT_WINDOW_FAILED",
			at: "2026-09-29T20:00:00Z",
			level: "error",
			data: {
				stage: "alignment",
				track: 2,
				window: 91,
				failure_class: "QWEN_ALIGNMENT_TIMESTAMP_OWNED_OVERFLOW",
				phase: "pre_ready",
				returncode: 64,
				stderr_truncated: true,
				runtime_version: "1.0.11",
				worker_sha256: "a".repeat(64),
				speaker: "Alice",
				transcript: "private words",
				audio_path: "C:\\private\\audio.wav",
				context: "private context",
				glossary: "private glossary",
				token: "secret",
			},
		};

		const sanitized = sanitizeJobDiagnosticEvent(event);

		expect(sanitized).toEqual({
			seq: 42,
			attempt: 3,
			code: "QWEN_ALIGNMENT_WINDOW_FAILED",
			at: "2026-09-29T20:00:00Z",
			level: "error",
			data: {
				stage: "alignment",
				track: 2,
				window: 91,
				failure_class: "QWEN_ALIGNMENT_TIMESTAMP_OWNED_OVERFLOW",
				phase: "pre_ready",
				returncode: 64,
				stderr_truncated: true,
				runtime_version: "1.0.11",
				worker_sha256: "a".repeat(64),
			},
		});
		expect(JSON.stringify(sanitized)).not.toContain("Alice");
		expect(JSON.stringify(sanitized)).not.toContain("private words");
		expect(JSON.stringify(sanitized)).not.toContain("audio.wav");
		expect(JSON.stringify(sanitized)).not.toContain("secret");
	});

	it("scopes visible events to the requested attempt while preserving attemptless lifecycle facts", () => {
		const events: JobEvent[] = [
			{
				seq: 1,
				attempt: 1,
				code: "OLD_ATTEMPT",
				at: "2026-09-29T19:00:00Z",
				level: "warning",
				data: {},
			},
			{
				seq: 2,
				attempt: 2,
				code: "CURRENT_ATTEMPT",
				at: "2026-09-29T20:00:00Z",
				level: "info",
				data: {},
			},
			{
				seq: 3,
				attempt: null,
				code: "JOB_CREATED",
				at: "2026-09-29T18:00:00Z",
				level: "info",
				data: {},
			},
		];

		expect(jobDiagnosticEventsForAttempt(events, 2).map((event) => event.code)).toEqual([
			"CURRENT_ATTEMPT",
			"JOB_CREATED",
		]);
	});
});
