import { describe, expect, it } from "vitest";
import {
	parseTranscriptMarkdownV1,
	renderTranscriptMarkdownV1,
	type TranscriptMarkdownImport,
} from "./markdown-contract";
import {
	applySessionAssemblyMarkdownImport,
	sessionAssemblyMarkdownBase,
	sessionAssemblyMarkdownSegments,
} from "./session-assembly-markdown";
import type {
	SessionAssembly,
	SessionAssemblyReviewSummary,
} from "@/features/edit/processing/session-composer-protocol";

const SOURCE = "craig-" + "a".repeat(64);

function assembly(): SessionAssembly {
	return {
		schemaVersion: "tda_session_assembly_v1",
		assemblyId: "1".repeat(64),
		campaignId: "yuhara-main",
		sessionId: "sessao-1118",
		inputsSha256: "1".repeat(64),
		timelineFingerprintSha256: "2".repeat(64),
		participantMappingSha256: "3".repeat(64),
		participantApprovalBlocked: false,
		transcriptSha256: "4".repeat(64),
		transcriptSizeBytes: 1024,
		segmentCount: 2,
		createdAt: "2026-09-30T00:00:00Z",
		parts: [
			{
				partId: "5".repeat(32),
				sourceId: SOURCE,
				sourceSha256: "a".repeat(64),
				runId: "run-1",
				transcriptSha256: "6".repeat(64),
				ordinal: 0,
				sessionOffsetSeconds: 90_000,
				trimStartSeconds: 0,
				trimEndSeconds: null,
				overlapResolution: null,
				overlapBoundarySeconds: null,
			},
		],
	};
}

function review(): SessionAssemblyReviewSummary {
	return {
		assemblyId: "1".repeat(64),
		baseTranscriptSha256: "4".repeat(64),
		status: "reviewed",
		persistence: "persisted",
		draftRevision: 3,
		draftSha256: "7".repeat(64),
		approvalCurrent: false,
		approvalBlocked: false,
		segmentCount: 2,
		reviewedSegments: 2,
		reviewPercent: 100,
		editedSegments: 0,
		wordCount: 4,
		segments: [
			{
				assemblySegmentId: "8".repeat(64),
				partId: "5".repeat(32),
				sourceId: SOURCE,
				runId: "run-1",
				sourceSegmentId: "source-1",
				trackNumber: 1,
				participantId: "9".repeat(32),
				start: 90_000,
				end: 90_001,
				absoluteTime: {
					startIso: "2026-09-29T23:59:59+01:00",
					endIso: "2026-09-30T00:00:00+01:00",
					source: SOURCE,
				},
				speaker: "Alya",
				text: "fala um",
				reviewed: true,
			},
			{
				assemblySegmentId: "b".repeat(64),
				partId: "5".repeat(32),
				sourceId: SOURCE,
				runId: "run-1",
				sourceSegmentId: "source-2",
				trackNumber: 1,
				participantId: "9".repeat(32),
				start: 90_005,
				end: 90_006,
				absoluteTime: null,
				speaker: "Noah",
				text: "fala dois",
				reviewed: true,
			},
		],
	};
}

describe("Session Assembly Markdown adapter", () => {
	it("binds Markdown to the exact Assembly draft and preserves >24h plus trusted wall-clock identity", () => {
		const a = assembly();
		const r = review();
		expect(sessionAssemblyMarkdownBase(a, r)).toEqual({
			sessionId: "sessao-1118",
			baseKind: "session_assembly",
			baseId: a.assemblyId,
			baseRevision: 3,
			baseSha256: "7".repeat(64),
		});
		expect(sessionAssemblyMarkdownSegments(r.segments)).toEqual([
			expect.objectContaining({
				id: "8".repeat(64),
				startMs: 90_000_000,
				endMs: 90_001_000,
				absoluteTime: r.segments[0].absoluteTime,
			}),
			expect.objectContaining({
				id: "b".repeat(64),
				startMs: 90_005_000,
				endMs: 90_006_000,
				absoluteTime: null,
			}),
		]);
	});

	it("round-trips through the shared strict parser and applies only speaker/text", async () => {
		const a = assembly();
		const r = review();
		const base = sessionAssemblyMarkdownBase(a, r);
		const markdownSegments = sessionAssemblyMarkdownSegments(r.segments);
		const markdown = await renderTranscriptMarkdownV1({
			base,
			segments: markdownSegments,
			title: a.sessionId,
			exportedAt: "2026-09-30T00:00:00Z",
		});
		const parsed = await parseTranscriptMarkdownV1({
			text: markdown
				.replace("**Alya**", "**Álya**")
				.replace("fala um", "fala um corrigida"),
			expectedBase: base,
			expectedSegments: markdownSegments,
		});
		const applied = applySessionAssemblyMarkdownImport(r.segments, parsed);
		expect(applied[0]).toMatchObject({
			...r.segments[0],
			speaker: "Álya",
			text: "fala um corrigida",
			reviewed: true,
		});
		expect(applied[0]?.assemblySegmentId).toBe(r.segments[0]?.assemblySegmentId);
		expect(applied[0]?.start).toBe(90_000);
		expect(applied[0]?.absoluteTime).toEqual(r.segments[0]?.absoluteTime);
	});

	it("fails closed when an imported segment set cannot map back to every Assembly identity", () => {
		const r = review();
		const result: TranscriptMarkdownImport = {
			segments: [
				{
					id: "8".repeat(64),
					startMs: 90_000_000,
					endMs: 90_001_000,
					speaker: "Alya",
					text: "fala um",
				},
			],
			changes: [],
			changedSegments: 0,
			speakerChanges: 0,
			textChanges: 0,
			unchangedSegments: 1,
			structureSha256: "c".repeat(64),
		};
		expect(() => applySessionAssemblyMarkdownImport(r.segments, result)).toThrow(
			"SESSION_ASSEMBLY_MARKDOWN_SEGMENT_MISMATCH",
		);
	});
});
