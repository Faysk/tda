import { describe, expect, it, vi } from "vitest";
import {
	LocalBridge,
	localBridgePaired,
	subscribeLocalBridgePairing,
} from "./bridge";
import { ProcessingController } from "./controller";
const token = "synthetic_test_token_12345678901234567890";
const health = {
	api_version: "1",
	service_version: "0.1.0",
	lifecycle: "ready",
};
const caps = {
	capabilities: ["synthetic.fixture"],
	sync: false,
	device: { id: "synthetic-device", label: "Test device" },
};
const job = {
	id: "test-job",
	kind: "synthetic.fixture",
	status: "running",
	stage: "fixture",
	progress: { completed: 1, total: 3, unit: "items" },
	error: null,
	result_available: false,
	updated_at: "2026-09-07T12:00:00Z",
};
function fixture() {
	const request = vi
		.fn<typeof fetch>()
		.mockImplementation(async (url) =>
			Response.json(
				String(url).endsWith("/health")
					? health
					: String(url).endsWith("/capabilities")
						? caps
						: { jobs: [job] },
			),
		);
	return {
		request,
		controller: new ProcessingController(new LocalBridge(request)),
	};
}
describe("processing state", () => {
	it("never probes until paired and keeps the last snapshot on transient refresh loss", async () => {
		const { request, controller } = fixture();
		expect(request).not.toHaveBeenCalled();
		await controller.refresh();
		expect(request).not.toHaveBeenCalled();
		await controller.connect(token);
		expect(controller.snapshot()).toMatchObject({
			connection: "connected",
			jobs: [job],
		});
		request.mockRejectedValue(new TypeError("CORS"));
		await controller.refresh();
		expect(controller.snapshot()).toMatchObject({
			connection: "connected",
			refreshError: "unreachable",
			health,
			capabilities: caps,
			jobs: [job],
			refreshing: false,
			mutation: null,
		});
	});
	it("preserves connected state when a local operation returns conflict", async () => {
		const { request, controller } = fixture();
		await controller.connect(token);
		request.mockImplementationOnce(async () =>
			Response.json(
				{ error: { code: "AGENT_BUSY", recoverable: true } },
				{ status: 409 },
			),
		);

		await controller.lifecycle("pause");

		expect(controller.snapshot()).toMatchObject({
			connection: "connected",
			error: "conflict",
			serverError: "AGENT_BUSY",
			jobs: [job],
			refreshing: false,
			mutation: null,
		});
	});

	it("keeps the shared pairing alive on transient refresh failure", async () => {
		const { request, controller } = fixture();
		await controller.connect(token);
		expect(localBridgePaired()).toBe(true);

		request.mockRejectedValue(new TypeError("temporary transport loss"));
		await controller.refresh();

		expect(controller.snapshot()).toMatchObject({
			connection: "connected",
			refreshError: "unreachable",
			jobs: [job],
		});
		expect(localBridgePaired()).toBe(true);
		controller.disconnect();
	});

	it("preserves version compatibility details for actionable UI diagnosis", async () => {
		const request = vi.fn<typeof fetch>().mockResolvedValue(
			Response.json({
				api_version: "1",
				service_version: "0.3.13",
				lifecycle: "ready",
			}),
		);
		const controller = new ProcessingController(new LocalBridge(request));

		await controller.connect();

		expect(controller.snapshot()).toMatchObject({
			connection: "error",
			error: "version_incompatible",
			errorDetails: {
				detectedServiceVersion: "0.3.13",
				minimumServiceVersion: "0.3.14",
			},
		});
	});

	it("connects automatically when the Companion is already open", async () => {
		const sessionToken = "browser_session_token_123456789012345678901234";
		const autoSessionHealth = { ...health, service_version: "0.3.14" };
		const request = vi.fn<typeof fetch>().mockImplementation(async (url) => {
			const value = String(url);
			if (value.endsWith("/health")) return Response.json(autoSessionHealth);
			if (value.endsWith("/session"))
				return Response.json({
					schema: "tda_loopback_session_v1",
					token: sessionToken,
					expires_in_seconds: 28_800,
				});
			if (value.endsWith("/capabilities")) return Response.json(caps);
			if (value.endsWith("/system"))
				return Response.json({
					sampled_at: "2026-09-19T00:00:00Z",
					host: { os: "Windows 11", cpu: null },
					cpu: { utilization_percent: null },
					memory: { used_bytes: null, total_bytes: null, percent: null },
					gpus: [],
				});
			return Response.json({ jobs: [job] });
		});
		const controller = new ProcessingController(new LocalBridge(request));

		await controller.connect();

		expect(controller.snapshot()).toMatchObject({
			connection: "connected",
			jobs: [job],
		});
		const sessionCall = request.mock.calls.find(([url]) =>
			String(url).endsWith("/session"),
		);
		expect(sessionCall?.[1]?.headers).not.toHaveProperty("Authorization");
		const jobsCall = request.mock.calls.find(([url]) =>
			String(url).endsWith("/jobs"),
		);
		expect(jobsCall?.[1]?.headers).toMatchObject({
			Authorization: `Bearer ${sessionToken}`,
		});
	});

	it("renews an expired browser session during an action and retries only that request", async () => {
		let sessionNumber = 0;
		let lifecycleAttempts = 0;
		let acceptedLifecycleActions = 0;
		const request = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
			const value = String(url);
			if (value.endsWith("/health"))
				return Response.json({ ...health, service_version: "0.3.14" });
			if (value.endsWith("/session")) {
				sessionNumber += 1;
				return Response.json({
					schema: "tda_loopback_session_v1",
					token: `browser_session_token_12345678901234567890123${sessionNumber}`,
					expires_in_seconds: 28_800,
				});
			}
			if (value.endsWith("/capabilities")) return Response.json(caps);
			if (value.endsWith("/lifecycle") && init?.method === "POST") {
				lifecycleAttempts += 1;
				if (lifecycleAttempts === 1) return new Response(null, { status: 401 });
				acceptedLifecycleActions += 1;
				expect(init.headers).toMatchObject({
					Authorization:
						"Bearer browser_session_token_123456789012345678901232",
				});
				return Response.json({ ...health, service_version: "0.3.14" });
			}
			return Response.json({ jobs: [job] });
		});
		const controller = new ProcessingController(new LocalBridge(request));

		await controller.connect();
		await controller.lifecycle("pause");

		expect(sessionNumber).toBe(2);
		expect(lifecycleAttempts).toBe(2);
		expect(acceptedLifecycleActions).toBe(1);
		expect(controller.snapshot()).toMatchObject({
			connection: "connected",
			error: null,
			jobs: [job],
		});
	});

	it("renews an expired automatic browser session during refresh", async () => {
		let sessionNumber = 0;
		let jobsReads = 0;
		const request = vi.fn<typeof fetch>().mockImplementation(async (url) => {
			const value = String(url);
			if (value.endsWith("/health"))
				return Response.json({ ...health, service_version: "0.3.14" });
			if (value.endsWith("/session")) {
				sessionNumber += 1;
				return Response.json({
					schema: "tda_loopback_session_v1",
					token: `browser_session_token_12345678901234567890123${sessionNumber}`,
					expires_in_seconds: 28_800,
				});
			}
			if (value.endsWith("/capabilities")) return Response.json(caps);
			if (value.endsWith("/jobs")) {
				jobsReads += 1;
				if (jobsReads === 2) return new Response(null, { status: 401 });
				return Response.json({ jobs: [job] });
			}
			return Response.json({ jobs: [job] });
		});
		const controller = new ProcessingController(new LocalBridge(request));

		await controller.connect();
		expect(controller.snapshot().connection).toBe("connected");
		expect(sessionNumber).toBe(1);
		const pairingStates: boolean[] = [];
		const unsubscribe = subscribeLocalBridgePairing(() => {
			pairingStates.push(localBridgePaired());
		});

		await controller.refresh();

		unsubscribe();
		expect(controller.snapshot().connection).toBe("connected");
		expect(controller.snapshot().error).toBeNull();
		expect(sessionNumber).toBe(2);
		expect(jobsReads).toBe(3);
		expect(pairingStates).not.toContain(false);
	});

	it("does not auto-bootstrap a legacy token after unauthorized", async () => {
		const { request, controller } = fixture();
		await controller.connect(token);
		request.mockClear();
		request.mockResolvedValueOnce(new Response(null, { status: 401 }));

		await controller.lifecycle("pause");

		expect(
			request.mock.calls.some(([url]) => String(url).endsWith("/session")),
		).toBe(false);
		expect(controller.snapshot()).toMatchObject({
			connection: "error",
			error: "unauthorized",
		});
	});

	it("does not send token to an API-incompatible service", async () => {
		const { request, controller } = fixture();
		request.mockResolvedValue(Response.json({ api_version: "99" }));
		await controller.connect(token);
		expect(controller.snapshot()).toMatchObject({
			error: "api_incompatible",
			errorDetails: {
				detectedApiVersion: "99",
				requiredApiVersion: "1",
			},
		});
		expect(request).toHaveBeenCalledTimes(1);
		expect(request.mock.calls[0][1]?.headers).not.toHaveProperty(
			"Authorization",
		);
	});
	it("ignores late responses after disconnect", async () => {
		const { request, controller } = fixture();
		let finish: ((value: Response) => void) | undefined;
		request.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		const pending = controller.connect(token);
		controller.disconnect();
		finish?.(Response.json(health));
		await pending;
		expect(controller.snapshot().connection).toBe("disconnected");
		expect(request).toHaveBeenCalledTimes(1);
	});
	it("keeps mutations available during background refresh and ignores late stale reads", async () => {
		const { request, controller } = fixture();
		await controller.connect(token);
		request.mockClear();

		await controller.jobAction(job.id, "retry");
		expect(request).not.toHaveBeenCalled();

		const fresherJob = {
			...job,
			updated_at: "2026-09-07T12:01:00Z",
		};
		let delayedJobs = true;
		let finishBackground: ((value: Response) => void) | undefined;
		request.mockImplementation(async (url, init) => {
			const value = String(url);
			if (value.endsWith("/health")) return Response.json(health);
			if (value.endsWith("/capabilities")) return Response.json(caps);
			if (value.endsWith("/jobs") && init?.method === "POST")
				return Response.json({
					...job,
					id: "synthetic-job",
					status: "queued",
					stage: "queued",
					progress: { completed: 0, total: 3, unit: "items" },
				});
			if (value.endsWith("/jobs") && delayedJobs) {
				delayedJobs = false;
				return new Promise((resolve) => {
					finishBackground = resolve;
				});
			}
			return Response.json({ jobs: [fresherJob] });
		});

		const background = controller.refresh("background");
		expect(controller.snapshot()).toMatchObject({
			refreshing: true,
			mutation: null,
			jobs: [job],
		});

		await controller.synthetic();
		expect(
			request.mock.calls.some(
				([url, init]) =>
					String(url).endsWith("/jobs") && init?.method === "POST",
			),
		).toBe(true);
		expect(controller.snapshot()).toMatchObject({
			connection: "connected",
			jobs: [fresherJob],
			mutation: null,
		});

		finishBackground?.(Response.json({ jobs: [job] }));
		await background;
		expect(controller.snapshot()).toMatchObject({
			connection: "connected",
			jobs: [fresherJob],
			refreshing: false,
		});
	});
	it("observes the oldest queued job because that is the next one executed", async () => {
		const newer = {
			...job,
			id: "queued-newer",
			status: "queued",
			stage: "queued",
			progress: { completed: 0, total: 3, unit: "items" },
			updated_at: "2026-09-19T12:01:00Z",
		};
		const older = {
			...job,
			id: "queued-older",
			status: "queued",
			stage: "queued",
			progress: { completed: 0, total: 3, unit: "items" },
			updated_at: "2026-09-19T12:00:00Z",
		};
		const request = vi.fn<typeof fetch>().mockImplementation(async (url) => {
			const value = String(url);
			if (value.endsWith("/health")) return Response.json(health);
			if (value.endsWith("/capabilities")) return Response.json(caps);
			return Response.json({ jobs: [newer, older] });
		});
		const controller = new ProcessingController(new LocalBridge(request));

		await controller.connect(token);

		expect(controller.snapshot().observedJobId).toBe("queued-older");
	});

	it("deletes only terminal jobs and refreshes them out of local history", async () => {
		let jobs: Array<Record<string, unknown>> = [job];
		const deleteHealth = { ...health, service_version: "0.3.11" };
		const request = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
			const value = String(url);
			if (value.endsWith("/health")) return Response.json(deleteHealth);
			if (value.endsWith("/capabilities")) return Response.json(caps);
			if (value.endsWith("/jobs/test-job/delete") && init?.method === "POST") {
				jobs = [];
				return Response.json({ deleted: true, id: "test-job" });
			}
			return Response.json({ jobs });
		});
		const controller = new ProcessingController(new LocalBridge(request));
		await controller.connect(token);

		request.mockClear();
		await controller.deleteJob(job.id);
		expect(request).not.toHaveBeenCalled();

		jobs = [
			{
				...job,
				status: "failed",
				stage: "failed",
				error: { code: "WORKER_EXECUTION_FAILED", recoverable: true },
			},
		];
		await controller.refresh();
		request.mockClear();

		await controller.deleteJob(job.id);

		expect(
			request.mock.calls.some(
				([url, init]) =>
					String(url).endsWith("/jobs/test-job/delete") &&
					init?.method === "POST",
			),
		).toBe(true);
		expect(controller.snapshot().jobs).toEqual([]);
	});

	it("does not call the delete endpoint on Companion 0.3.10", async () => {
		const oldHealth = { ...health, service_version: "0.3.10" };
		const terminal = {
			...job,
			status: "failed",
			stage: "failed",
			error: { code: "WORKER_EXECUTION_FAILED", recoverable: true },
		};
		const request = vi.fn<typeof fetch>().mockImplementation(async (url) => {
			const value = String(url);
			if (value.endsWith("/health")) return Response.json(oldHealth);
			if (value.endsWith("/capabilities")) return Response.json(caps);
			return Response.json({ jobs: [terminal] });
		});
		const controller = new ProcessingController(new LocalBridge(request));
		await controller.connect(token);
		request.mockClear();

		await controller.deleteJob(job.id);

		expect(request).not.toHaveBeenCalled();
		expect(controller.snapshot().jobs).toHaveLength(1);
		expect(controller.snapshot().jobs[0]).toMatchObject(terminal);
	});

	it("reuses idempotency key after an uncertain submission", async () => {
		const { request, controller } = fixture();
		await controller.connect(token);
		request.mockImplementationOnce(async () => {
			throw new TypeError("response lost");
		});
		await controller.synthetic();
		expect(controller.snapshot().uncertainSubmission).toBe(true);
		const firstPost = request.mock.calls.find(
			([, init]) => init?.method === "POST",
		);
		await controller.connect(token);
		request.mockImplementationOnce(async () => Response.json(job));
		await controller.synthetic();
		const posts = request.mock.calls.filter(
			([, init]) => init?.method === "POST",
		);
		expect(posts).toHaveLength(2);
		expect(posts[1][1]?.headers).toEqual(firstPost?.[1]?.headers);
		expect(controller.snapshot().uncertainSubmission).toBe(false);
	});

	it("loads local result metadata from source catalog without opening transcript content", async () => {
		const sourceSha = "a".repeat(64);
		const sourceId = `craig-${sourceSha}`;
		const runId = "run-library-a1";
		const reviewCaps = {
			...caps,
			capabilities: ["synthetic.fixture", "transcription.review"],
		};
		const request = vi.fn<typeof fetch>().mockImplementation(async (url) => {
			const value = String(url);
			if (value.endsWith("/health")) return Response.json(health);
			if (value.endsWith("/capabilities")) return Response.json(reviewCaps);
			if (value.endsWith("/jobs")) return Response.json({ jobs: [] });
			if (value.endsWith("/sources"))
				return Response.json({
					schema_version: "tda_craig_sources_v1",
					sources: [
						{
							source_id: sourceId,
							source_sha256: sourceSha,
							recording_id: null,
							track_count: 1,
						},
					],
				});
			if (value.endsWith(`/sources/${sourceId}/runs`))
				return Response.json({
					schema_version: "tda_transcription_runs_v1",
					source_id: sourceId,
					runs: [
						{
							run_id: runId,
							status: "completed",
							source_id: sourceId,
							profile_id: "whisper-detailed",
							engine: "faster-whisper",
							model: "large-v3",
							model_revision: "rev",
							language: "pt",
							completed_at: "2026-09-21T00:00:00Z",
							transcript_sha256: "b".repeat(64),
							transcript_size_bytes: 1200,
							stats: { warning_count: 1 },
						},
					],
				});
			throw new Error(`unexpected request: ${value}`);
		});
		const controller = new ProcessingController(new LocalBridge(request));

		await controller.connect(token);

		expect(controller.snapshot()).toMatchObject({
			connection: "connected",
			localSources: [{ sourceId }],
			localRuns: [{ sourceId, runId }],
			localReview: null,
		});
		const libraryReadsBefore = request.mock.calls.filter(
			([url]) =>
				String(url).endsWith("/sources") ||
				String(url).endsWith(`/sources/${sourceId}/runs`),
		).length;
		await controller.refresh("background");
		const libraryReadsAfter = request.mock.calls.filter(
			([url]) =>
				String(url).endsWith("/sources") ||
				String(url).endsWith(`/sources/${sourceId}/runs`),
		).length;
		expect(libraryReadsAfter).toBe(libraryReadsBefore);
		expect(
			request.mock.calls.some(([url]) => String(url).endsWith("/review")),
		).toBe(false);
	});

	it("opens review only on explicit action and keeps stale-save conflict local to the editor", async () => {
		const sourceSha = "c".repeat(64);
		const sourceId = `craig-${sourceSha}`;
		const runId = "run-review-a1";
		const reviewCaps = {
			...caps,
			capabilities: ["transcription.review"],
		};
		const rawReview = {
			schema_version: "tda_local_review_v1",
			source_id: sourceId,
			run_id: runId,
			base_transcript_sha256: "d".repeat(64),
			draft_revision: 0,
			draft_sha256: "e".repeat(64),
			status: "draft",
			created_at: "2026-09-21T00:00:00Z",
			updated_at: "2026-09-21T00:00:00Z",
			lineage: {
				profile_id: "whisper-detailed",
				engine: "faster-whisper",
				model: "large-v3",
				model_revision: "rev",
				device: "cuda",
				compute_type: "float16",
				alignment: "native",
				completed_at: "2026-09-21T00:00:00Z",
			},
			stats: {
				processing_seconds: 1,
				session_duration_seconds: 2,
				rtf: 0.5,
				word_count: 2,
				segment_count: 1,
				track_count: 1,
			},
			warnings: [],
			review: {
				reviewed_segments: 0,
				total_segments: 1,
				review_percent: 0,
				edited_segments: 0,
				word_count: 2,
				warning_count: 0,
			},
			segments: [
				{
					track_number: 1,
					segment_id: "1-0",
					start: 0,
					end: 1,
					text: "Texto local",
					speaker: "Alice",
					reviewed: false,
				},
			],
			sync: { status: "not_configured" },
		};
		let reviewPosts = 0;
		const request = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
			const value = String(url);
			if (value.endsWith("/health")) return Response.json(health);
			if (value.endsWith("/capabilities")) return Response.json(reviewCaps);
			if (value.endsWith("/jobs")) return Response.json({ jobs: [] });
			if (value.endsWith("/sources"))
				return Response.json({
					schema_version: "tda_craig_sources_v1",
					sources: [
						{
							source_id: sourceId,
							source_sha256: sourceSha,
							recording_id: null,
							track_count: 1,
						},
					],
				});
			if (value.endsWith(`/sources/${sourceId}/runs`))
				return Response.json({
					schema_version: "tda_transcription_runs_v1",
					source_id: sourceId,
					runs: [
						{
							run_id: runId,
							status: "completed",
							source_id: sourceId,
							profile_id: "whisper-detailed",
							engine: "faster-whisper",
							model: "large-v3",
							model_revision: "rev",
							language: "pt",
							completed_at: "2026-09-21T00:00:00Z",
							transcript_sha256: "d".repeat(64),
							transcript_size_bytes: 1200,
							stats: {},
						},
					],
				});
			if (value.endsWith("/review") && init?.method === "GET")
				return Response.json(rawReview);
			if (value.endsWith("/review") && init?.method === "POST") {
				reviewPosts += 1;
				return Response.json(
					{ error: { code: "LOCAL_REVIEW_DRAFT_CONFLICT", recoverable: true } },
					{ status: 409 },
				);
			}
			throw new Error(`unexpected request: ${value}`);
		});
		const controller = new ProcessingController(new LocalBridge(request));
		await controller.connect(token);
		expect(controller.snapshot().localReview).toBeNull();

		await controller.openLocalReview(sourceId, runId);
		expect(controller.snapshot().localReview).toMatchObject({
			sourceId,
			runId,
			draftRevision: 0,
		});

		const current = controller.snapshot().localReview;
		if (!current) throw new Error("review did not open");
		await controller.saveLocalReview(
			current.draftRevision,
			"reviewed",
			current.segments,
		);

		expect(reviewPosts).toBe(1);
		expect(controller.snapshot()).toMatchObject({
			connection: "connected",
			localReview: { sourceId, runId, draftRevision: 0 },
			localReviewBusy: false,
			localReviewError: "LOCAL_REVIEW_DRAFT_CONFLICT",
		});
		expect(controller.snapshot().error).toBeNull();
	});
});
