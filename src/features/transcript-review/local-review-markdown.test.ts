import { describe, expect, it } from "vitest";
import type { LocalReview } from "@/features/edit/processing/protocol";
import {
	applyLocalReviewMarkdownImport,
	localReviewMarkdownBase,
	localReviewMarkdownSegments,
} from "./local-review-markdown";

function review(): LocalReview {
	return {
		sourceId: "craig-" + "a".repeat(64),
		runId: "run-1",
		baseTranscriptSha256: "b".repeat(64),
		draftRevision: 4,
		draftSha256: "c".repeat(64),
		persistence: "persisted",
		snapshotContract: "tda_local_review_cas_v1",
		status: "approved_local",
		approvalCurrent: true,
		approvedAt: "2026-09-30T00:00:00Z",
		createdAt: "2026-09-30T00:00:00Z",
		updatedAt: "2026-09-30T00:00:00Z",
		lineage: {
			profileId: "qwen-quality",
			engine: "qwen",
			model: "synthetic",
			modelRevision: null,
			device: null,
			computeType: null,
			alignment: null,
			executionLineage: null,
			completedAt: "2026-09-30T00:00:00Z",
		},
		stats: {
			audioWorkSeconds: 10,
			processingSeconds: 3,
			sessionDurationSeconds: 10,
			rtf: 0.3,
			wordCount: 4,
			segmentCount: 1,
			trackCount: 1,
		},
		warnings: [],
		publicationTarget: {
			campaignSlug: "campanha",
			sourceSessionId: "sessao-42",
			jobId: "job-1",
			attempt: 1,
		},
		review: {
			reviewedSegments: 1,
			totalSegments: 1,
			reviewPercent: 100,
			editedSegments: 0,
			wordCount: 4,
			warningCount: 0,
		},
		segments: [
			{
				trackNumber: 7,
				segmentId: "source-segment",
				start: 1,
				end: 2,
				timelineStart: 11,
				timelineEnd: 12,
				text: "Texto original",
				speaker: "Alya",
				reviewed: true,
			},
		],
		sync: { status: "not_configured" },
	};
}

describe("local review Markdown adapter", () => {
	it("binds export identity to the exact persisted draft", () => {
		const value = review();
		expect(localReviewMarkdownBase(value)).toEqual({
			sessionId: "sessao-42",
			baseKind: "local_run",
			baseId: value.sourceId + "/" + value.runId,
			baseRevision: 4,
			baseSha256: "c".repeat(64),
		});
		expect(localReviewMarkdownSegments(value)[0]).toMatchObject({
			id: "track:7:segment:source-segment",
			startMs: 11_000,
			endMs: 12_000,
		});
	});

	it("applies only speaker and text and preserves local structural fields", () => {
		const value = review();
		const next = applyLocalReviewMarkdownImport(value.segments, {
			segments: [
				{
					id: "track:7:segment:source-segment",
					startMs: 11_000,
					endMs: 12_000,
					speaker: "Álya",
					text: "Texto corrigido",
				},
			],
			changes: [],
			changedSegments: 1,
			speakerChanges: 1,
			textChanges: 1,
			unchangedSegments: 0,
			structureSha256: "d".repeat(64),
		});
		expect(next[0]).toEqual({
			...value.segments[0],
			speaker: "Álya",
			text: "Texto corrigido",
		});
		expect(next[0].reviewed).toBe(true);
		expect(next[0].timelineStart).toBe(11);
	});
});
