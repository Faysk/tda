import { describe, expect, it } from "vitest";
import {
	PUBLICATION_PAYLOAD_VERSION,
	preparePublication,
	sha256Utf8,
} from "./contract";

const sourceId = `craig-${"a".repeat(64)}`;
const transcriptSha = "b".repeat(64);
const draftSha = "c".repeat(64);

function requestValue() {
	return {
		schemaVersion: "tda_transcript_publication_request_v1",
		operationId: "11111111-1111-4111-8111-111111111111",
		binding: {
			schemaVersion: "tda_publication_target_v1",
			campaignSlug: "yuhara-main",
			sourceSessionId: "sessao-00001",
			sourceId,
			runId: "run-job-a1",
			jobId: "job-a",
			attempt: 1,
			transcriptSha256: transcriptSha,
		},
		review: {
			sourceId,
			runId: "run-job-a1",
			baseTranscriptSha256: transcriptSha,
			draftRevision: 3,
			draftSha256: draftSha,
			status: "approved_local",
			lineage: {
				profileId: "whisper-detailed",
				engine: "faster-whisper",
				model: "large-v3",
				modelRevision: "rev-1",
				device: "cuda",
				computeType: "float16",
				alignment: "native",
				completedAt: "2026-09-21T12:00:00Z",
			},
			warnings: ["LOW_CONFIDENCE"],
			review: {
				reviewedSegments: 1,
				totalSegments: 1,
				reviewPercent: 100,
				editedSegments: 1,
				wordCount: 2,
				warningCount: 1,
			},
			segments: [
				{
					trackNumber: 1,
					segmentId: "1-0",
					start: 0.1,
					end: 1.5,
					text: "Olá mundo",
					speaker: "Alice",
					reviewed: true,
				},
			],
		},
	};
}

describe("transcript publication contract", () => {
	it("rebuilds a canonical server payload and hashes the exact UTF-8 bytes", () => {
		const parsed = preparePublication(JSON.stringify(requestValue()));
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;

		expect(parsed.value.target).toEqual({
			campaignSlug: "yuhara-main",
			sourceSessionId: "sessao-00001",
		});
		expect(parsed.value.payloadSha256).toBe(
			sha256Utf8(parsed.value.payloadJson),
		);
		const payload = JSON.parse(parsed.value.payloadJson);
		expect(payload).toMatchObject({
			schema_version: PUBLICATION_PAYLOAD_VERSION,
			source_id: sourceId,
			run_id: "run-job-a1",
			base_transcript_sha256: transcriptSha,
			draft_sha256: draftSha,
			review: {
				status: "approved_local",
				draft_revision: 3,
				reviewed_segments: 1,
				total_segments: 1,
				warning_count: 1,
				word_count: 2,
			},
		});
		expect(payload).not.toHaveProperty("job_id");
		expect(payload).not.toHaveProperty("campaign_slug");
		expect(parsed.value.payloadJson).not.toContain("yuhara-main");
	});

	it("requires explicit local approval", () => {
		const value = requestValue();
		value.review.status = "reviewed";
		expect(preparePublication(JSON.stringify(value))).toEqual({
			ok: false,
			reason: "approved_review_required",
		});
	});

	it("fails closed when durable binding identity differs from the review", () => {
		for (const patch of [
			{ sourceId: `craig-${"d".repeat(64)}` },
			{ runId: "run-other-a1" },
			{ baseTranscriptSha256: "e".repeat(64) },
		]) {
			const value = requestValue();
			Object.assign(value.review, patch);
			expect(preparePublication(JSON.stringify(value))).toEqual({
				ok: false,
				reason: "invalid_payload",
			});
		}
	});

	it("recomputes review counts instead of trusting browser summary fields", () => {
		const value = requestValue();
		value.review.review.wordCount = 999;
		expect(preparePublication(JSON.stringify(value))).toEqual({
			ok: false,
			reason: "invalid_payload",
		});

		const duplicate = requestValue();
		duplicate.review.segments.push({ ...duplicate.review.segments[0] });
		duplicate.review.review.totalSegments = 2;
		duplicate.review.review.reviewedSegments = 2;
		duplicate.review.review.wordCount = 4;
		expect(preparePublication(JSON.stringify(duplicate))).toEqual({
			ok: false,
			reason: "invalid_payload",
		});
	});

	it("rejects unknown top-level fields instead of silently forwarding them", () => {
		const value = { ...requestValue(), publishAutomatically: true };
		expect(preparePublication(JSON.stringify(value))).toEqual({
			ok: false,
			reason: "invalid_payload",
		});
	});
});
