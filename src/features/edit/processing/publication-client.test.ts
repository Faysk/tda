import { describe, expect, it, vi } from "vitest";
import { parseLocalReview, type LocalReview } from "./protocol";
import { preparePublication } from "../../transcript-publication/contract";
import {
	PublicationClientError,
	preflightApprovedLocalReview,
	publicationRequestBody,
	publishApprovedLocalReview,
} from "./publication-client";

const sourceId = `craig-${"a".repeat(64)}`;
const review: LocalReview = {
	sourceId,
	runId: "run-job-a1",
	baseTranscriptSha256: "b".repeat(64),
	draftRevision: 2,
	draftSha256: "c".repeat(64),
	status: "approved_local",
	approvalCurrent: true,
	approvedAt: "2026-09-21T12:01:00Z",
	createdAt: "2026-09-21T12:00:00Z",
	updatedAt: "2026-09-21T12:01:00Z",
	lineage: {
		profileId: "whisper-detailed",
		engine: "faster-whisper",
		model: "large-v3",
		modelRevision: null,
		device: "cuda",
		computeType: "float16",
		alignment: "native",
		executionLineage: {
			schemaVersion: "tda_execution_lineage_v1",
			companionVersion: "0.3.14",
			runtimeFamily: "whisper",
			runtimeVersion: "1.1.5",
            runtimeArtifact: { runtimeId: "whisper-ctranslate2", version: "1.1.5", workerSha256: "f".repeat(64), archiveSha256: null },
			device: "cuda",
			computeType: "float16",
			gpu: {
				vendor: "NVIDIA",
				index: 0,
				model: "NVIDIA Test GPU",
				vramTotalBytes: 8 * 1024 ** 3,
				computeCapability: "8.9",
				driverVersion: "600.12",
			},
		},
		completedAt: "2026-09-21T11:59:00Z",
	},
	stats: {
		audioWorkSeconds: 60,
		processingSeconds: 12,
		sessionDurationSeconds: 60,
		rtf: 0.2,
		wordCount: 2,
		segmentCount: 1,
		trackCount: 1,
	},
	warnings: [],
	publicationTarget: {
		campaignSlug: "yuhara-main",
		sourceSessionId: "sessao-00001",
		jobId: "job-a",
		attempt: 1,
	},
	review: {
		reviewedSegments: 1,
		totalSegments: 1,
		reviewPercent: 100,
		editedSegments: 1,
		wordCount: 2,
		warningCount: 0,
	},
	segments: [
		{
			trackNumber: 1,
			segmentId: "1-0",
			start: 0,
			end: 1,
			text: "Olá mundo",
			speaker: "Alice",
			reviewed: true,
		},
	],
	sync: { status: "not_configured" },
};

const receipt = {
	ok: true,
	receipt: {
		schemaVersion: "tda_transcript_publication_receipt_v1",
		status: "committed",
		receiptId: "11111111-1111-4111-8111-111111111111",
		campaignId: "22222222-2222-4222-8222-222222222222",
		sessionId: "33333333-3333-4333-8333-333333333333",
		revisionId: "44444444-4444-4444-8444-444444444444",
		revisionNumber: 7,
		operationId: "55555555-5555-4555-8555-555555555555",
		sourceId,
		runId: "run-job-a1",
		baseTranscriptSha256: "b".repeat(64),
		draftSha256: "c".repeat(64),
		payloadSha256: "d".repeat(64),
		segmentCount: 1,
		wordCount: 2,
		committedAt: "2026-09-21T12:02:00Z",
	},
};

describe("publication client", () => {
	it.each(["503", "invalid-json", "invalid-receipt"])(
		"reconciles ambiguous %s with byte-identical lookup",
		async (mode) => {
			const first =
				mode === "503"
					? Response.json(
							{ ok: false, reason: "dependency_unavailable" },
							{ status: 503 },
						)
					: mode === "invalid-json"
						? new Response("{")
						: Response.json({ ok: true, receipt: {} });
			const transport = vi
				.fn<typeof fetch>()
				.mockResolvedValueOnce(first)
				.mockResolvedValueOnce(Response.json(receipt));
			await expect(
				publishApprovedLocalReview(
					review,
					receipt.receipt.operationId,
					null,
					transport,
				),
			).resolves.toMatchObject({ revisionNumber: 7 });
			expect(transport).toHaveBeenCalledTimes(2);
			expect(transport.mock.calls[1][0]).toBe(
				"/api/transcript-publications/receipt",
			);
			expect(transport.mock.calls[1][1]?.body).toBe(
				transport.mock.calls[0][1]?.body,
			);
		},
	);
	it.each(["not_found", "dependency_unavailable"])(
		"keeps ambiguous publish unresolved after %s readback",
		async (reason) => {
			const transport = vi
				.fn<typeof fetch>()
				.mockResolvedValueOnce(
					Response.json({ reason: "dependency_unavailable" }, { status: 503 }),
				)
				.mockResolvedValueOnce(
					Response.json(
						{ reason },
						{ status: reason === "not_found" ? 404 : 503 },
					),
				);
			await expect(
				publishApprovedLocalReview(
					review,
					receipt.receipt.operationId,
					null,
					transport,
				),
			).rejects.toMatchObject({ code: "unconfirmed" });
		},
	);
	it.each([
		"unauthenticated",
		"forbidden",
		"invalid_payload",
		"too_large",
		"not_found",
		"conflict",
		"stale_current",
	])("does not read back definitive %s", async (reason) => {
		const transport = vi
			.fn<typeof fetch>()
			.mockResolvedValue(Response.json({ reason }, { status: 400 }));
		await expect(
			publishApprovedLocalReview(
				review,
				receipt.receipt.operationId,
				null,
				transport,
			),
		).rejects.toMatchObject({ code: reason });
		expect(transport).toHaveBeenCalledTimes(1);
	});
	it.each([
		"operationId",
		"sourceId",
		"runId",
		"baseTranscriptSha256",
		"draftSha256",
	])("rejects readback for another %s", async (field) => {
		const transport = vi
			.fn<typeof fetch>()
			.mockRejectedValueOnce(new TypeError("lost"))
			.mockResolvedValueOnce(
				Response.json({
					...receipt,
					receipt: { ...receipt.receipt, [field]: "different" },
				}),
			);
		await expect(
			publishApprovedLocalReview(
				review,
				receipt.receipt.operationId,
				null,
				transport,
			),
		).rejects.toMatchObject({ code: "conflict" });
	});
	it("publishes an approved review with the durable target binding", async () => {
		const transport = vi
			.fn<typeof fetch>()
			.mockResolvedValue(Response.json(receipt));
		const result = await publishApprovedLocalReview(
			review,
			"55555555-5555-4555-8555-555555555555",
			null,
			transport,
		);
		expect(result).toMatchObject({ revisionNumber: 7 });
		const [path, init] = transport.mock.calls[0];
		expect(path).toBe("/api/transcript-publications");
		const body = JSON.parse(String(init?.body));
		expect(body).toMatchObject({
			operationId: "55555555-5555-4555-8555-555555555555",
			binding: {
				campaignSlug: "yuhara-main",
				sourceSessionId: "sessao-00001",
				jobId: "job-a",
				attempt: 1,
			},
			review: {
				status: "approved_local",
				draftSha256: "c".repeat(64),
			},
		});
		expect(body.review.lineage).not.toHaveProperty("executionLineage");
		expect(body).not.toHaveProperty("status");
		expect(body).not.toHaveProperty("title");
		expect(body).not.toHaveProperty("summary");
		expect(body).not.toHaveProperty("cover");
		expect(JSON.stringify(body)).not.toContain("NVIDIA Test GPU");
        expect(JSON.stringify(body)).not.toContain("f".repeat(64));
	});

	it("preserves trusted single-source wall-clock metadata through the real publication client", () => {
		const operationId = "55555555-5555-4555-8555-555555555555";
		const withAbsolute: LocalReview = {
			...review,
			segments: review.segments.map((segment) => ({
				...segment,
				absoluteTime: {
					startIso: "2026-09-12T23:59:59+01:00",
					endIso: "2026-09-13T00:00:00+01:00",
					source: sourceId,
				},
			})),
		};

		const body = publicationRequestBody(withAbsolute, operationId, null);
		expect(body.review.segments[0]?.absoluteTime).toEqual({
			startIso: "2026-09-12T23:59:59+01:00",
			endIso: "2026-09-13T00:00:00+01:00",
			source: sourceId,
		});
		const prepared = preparePublication(JSON.stringify(body));
		expect(prepared.ok).toBe(true);
		if (!prepared.ok) throw new Error("expected canonical publication");
		const payload = JSON.parse(prepared.value.payloadJson);
		expect(payload.segments[0]).toMatchObject({
			absolute_time_state: "trusted_absolute",
			absolute_start: "2026-09-12T23:59:59+01:00",
			absolute_end: "2026-09-13T00:00:00+01:00",
			absolute_time_source: sourceId,
		});
	});

	it("strips timeline projection fields before canonical handoff without changing payload identity", () => {
		const operationId = "55555555-5555-4555-8555-555555555555";
		const withTimeline: LocalReview = {
			...review,
			segments: review.segments.map((segment) => ({
				...segment,
				timelineStart: segment.start + 120,
				timelineEnd: segment.end + 120,
			})),
		};

		const projectedBody = publicationRequestBody(withTimeline, operationId, null);
		expect(projectedBody.review.segments[0]).not.toHaveProperty("timelineStart");
		expect(projectedBody.review.segments[0]).not.toHaveProperty("timelineEnd");
		expect(preflightApprovedLocalReview(withTimeline)).toMatchObject({
			eligible: true,
			reason: null,
		});

		const baseline = preparePublication(
			JSON.stringify(publicationRequestBody(review, operationId, null)),
		);
		const projected = preparePublication(JSON.stringify(projectedBody));
		expect(baseline.ok).toBe(true);
		expect(projected.ok).toBe(true);
		if (!baseline.ok || !projected.ok) throw new Error("expected canonical publication");
		expect(projected.value.payloadSha256).toBe(baseline.value.payloadSha256);
	});

	it("accepts the real parsed review shape with absolute timeline but keeps unknown canonical keys fail-closed", () => {
		const parsed = parseLocalReview(
			{
				schema_version: "tda_local_review_v1",
				source_id: sourceId,
				run_id: review.runId,
				base_transcript_sha256: review.baseTranscriptSha256,
				snapshot_contract: "tda_local_review_cas_v1",
				persistence: "persisted",
				draft_revision: review.draftRevision,
				draft_sha256: review.draftSha256,
				status: "approved_local",
				approval_current: true,
				approved_at: review.approvedAt,
				created_at: review.createdAt,
				updated_at: review.updatedAt,
				lineage: {
					profile_id: review.lineage.profileId,
					engine: review.lineage.engine,
					model: review.lineage.model,
					model_revision: review.lineage.modelRevision,
					device: review.lineage.device,
					compute_type: review.lineage.computeType,
					alignment: review.lineage.alignment,
					execution_lineage: null,
					completed_at: review.lineage.completedAt,
				},
				stats: {
					audio_work_seconds: review.stats.audioWorkSeconds,
					processing_seconds: review.stats.processingSeconds,
					processing_metrics: null,
					session_duration_seconds: review.stats.sessionDurationSeconds,
					rtf: review.stats.rtf,
					word_count: review.stats.wordCount,
					segment_count: review.stats.segmentCount,
					track_count: review.stats.trackCount,
				},
				warnings: [],
				warning_summary: { total_count: 0, displayed_count: 0, truncated: false },
				publication_target_state: "valid",
				publication_target: {
					schema_version: "tda_publication_target_v1",
					campaign_slug: "yuhara-main",
					source_session_id: "sessao-00001",
					source_id: sourceId,
					run_id: review.runId,
					job_id: "job-a",
					attempt: 1,
					transcript_sha256: review.baseTranscriptSha256,
				},
				review: {
					reviewed_segments: 1,
					total_segments: 1,
					review_percent: 100,
					edited_segments: 1,
					word_count: 2,
					warning_count: 0,
				},
				segments: [
					{
						track_number: 1,
						segment_id: "1-0",
						start: 0,
						end: 1,
						timeline_start: 120,
						timeline_end: 121,
						text: "Olá mundo",
						speaker: "Alice",
						reviewed: true,
					},
				],
				sync: { status: "not_configured" },
			},
			{ requireAbsoluteTimeline: true },
		);
		expect(parsed.segments[0]).toMatchObject({ timelineStart: 120, timelineEnd: 121 });
		expect(preflightApprovedLocalReview(parsed)).toMatchObject({ eligible: true, reason: null });

		const body = publicationRequestBody(
			parsed,
			"55555555-5555-4555-8555-555555555555",
			null,
		);
		const malformed = structuredClone(body) as typeof body & {
			review: typeof body.review & { segments: Array<Record<string, unknown>> };
		};
		malformed.review.segments[0].unexpected = true;
		expect(preparePublication(JSON.stringify(malformed))).toEqual({
			ok: false,
			reason: "invalid_payload",
		});
	});

	it("uses receipt readback after an ambiguous network failure", async () => {
		const transport = vi
			.fn<typeof fetch>()
			.mockRejectedValueOnce(new TypeError("connection reset"))
			.mockResolvedValueOnce(Response.json(receipt));
		const result = await publishApprovedLocalReview(
			review,
			"55555555-5555-4555-8555-555555555555",
			null,
			transport,
		);
		expect(result.revisionId).toBe("44444444-4444-4444-8444-444444444444");
		expect(transport.mock.calls.map(([path]) => path)).toEqual([
			"/api/transcript-publications",
			"/api/transcript-publications/receipt",
		]);
		expect(transport.mock.calls[0][1]?.body).toBe(
			transport.mock.calls[1][1]?.body,
		);
	});

	it("does not turn an explicit server rejection into an ambiguous retry", async () => {
		const transport = vi
			.fn<typeof fetch>()
			.mockResolvedValue(
				Response.json({ ok: false, reason: "forbidden" }, { status: 403 }),
			);
		await expect(
			publishApprovedLocalReview(
				review,
				"55555555-5555-4555-8555-555555555555",
				null,
				transport,
			),
		).rejects.toMatchObject({ code: "forbidden" });
		expect(transport).toHaveBeenCalledTimes(1);
	});

	it("keeps an operation unconfirmed when neither POST nor readback can prove commit", async () => {
		const transport = vi
			.fn<typeof fetch>()
			.mockRejectedValueOnce(new TypeError("connection reset"))
			.mockResolvedValueOnce(
				Response.json({ ok: false, reason: "not_found" }, { status: 404 }),
			);
		await expect(
			publishApprovedLocalReview(
				review,
				"55555555-5555-4555-8555-555555555555",
				null,
				transport,
			),
		).rejects.toEqual(new PublicationClientError("unconfirmed"));
	});
});
