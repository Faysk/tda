import { publishApprovedLocalReview } from "../../src/features/edit/processing/publication-client";
import { LocalReviewWorkspace } from "../../src/features/edit/processing/local-review";
import type { LocalReview, LocalRunSummary } from "../../src/features/edit/processing/protocol";
import { useState } from "react";

// Synthetic browser data; the product never imports this isolated harness.
export function ReviewFixture() {
	const publication = new URLSearchParams(location.search).has("publication");
	const legacy = new URLSearchParams(location.search).has("legacy");
	const ephemeral = new URLSearchParams(location.search).has("ephemeral");
	const oldAgent = new URLSearchParams(location.search).has("old-agent");
	const bulk = new URLSearchParams(location.search).has("bulk");
	const comparisonMode = new URLSearchParams(location.search).has("comparison");
	const metricsMode = new URLSearchParams(location.search).has("metrics") || comparisonMode;
    const [saveCount, setSaveCount] = useState(0);
    const [openedRunId, setOpenedRunId] = useState("");
    const [saveError, setSaveError] = useState<string | null>(null);
    const [review, setReview] = useState<LocalReview>({
		sourceId: `craig-${"a".repeat(64)}`,
		runId: "run-synthetic-a1",
		baseTranscriptSha256: "b".repeat(64),
		draftSha256: ephemeral ? null : "c".repeat(64),
		draftRevision: ephemeral ? null : 1,
		persistence: ephemeral ? "ephemeral_base" : "persisted",
		...(oldAgent ? {} : { snapshotContract: "tda_local_review_cas_v1" }),
		status: bulk || publication ? "approved_local" : "draft",
		approvalCurrent: bulk || publication,
		approvedAt: bulk || publication ? "2026-09-26T12:00:01Z" : null,
		createdAt: ephemeral ? null : "2026-09-26T12:00:00Z",
		updatedAt: ephemeral ? null : "2026-09-26T12:00:00Z",
		lineage: {
			profileId: "whisper-detailed",
			engine: "faster-whisper",
			model: "large-v3",
			modelRevision: null,
			device: "cpu",
			computeType: "int8",
			alignment: "native",
			executionLineage: new URLSearchParams(location.search).has("artifact") ? {
                schemaVersion: "tda_execution_lineage_v1", companionVersion: "synthetic", runtimeFamily: "whisper", runtimeVersion: "1.1.5", device: "cpu", computeType: "int8", gpu: null,
                runtimeArtifact: { runtimeId: "whisper-ctranslate2", version: "1.1.5", workerSha256: "a".repeat(64), archiveSha256: "b".repeat(64) },
            } : null,
			completedAt: "2026-09-26T12:00:00Z",
		},
		stats: {
			audioWorkSeconds: 60,
			processingSeconds: 30,
			sessionDurationSeconds: 60,
			rtf: 0.5,
			wordCount: 2,
			segmentCount: 1,
			trackCount: 1,
		},
		warnings: Array.from(
			{ length: 1000 },
			(_, index) => `SYNTHETIC_WARNING_${index % 75}`,
		),
		...(legacy
			? {}
			: {
					warningSummary: {
						totalCount: 5000,
						displayedCount: 1000,
						truncated: true,
					},
				}),
		publicationTarget: publication ? { campaignSlug: "yuhara-main", sourceSessionId: "sessao-synthetic", jobId: "synthetic", attempt: 1 } : null,
		publicationTargetState: "invalid",
		review: {
			reviewedSegments: 0,
			totalSegments: 1,
			reviewPercent: 0,
			editedSegments: 0,
			wordCount: 2,
			warningCount: legacy ? 1000 : 5000,
		},
		segments: bulk ? Array.from({ length: 5 }, (_, index) => ({
            trackNumber: index === 4 ? 2 : 1, segmentId: `s-${index}`, start: index, end: index + 1,
            text: `Fala ${index}`, speaker: index === 3 ? "Convidado" : "Alex", reviewed: true,
        })) : [
			{
				trackNumber: 1,
				segmentId: "1-0",
				start: 0,
				end: 1,
				...(publication ? { timelineStart: 120, timelineEnd: 121 } : {}),
				text: "Olá\u0085mundo",
				speaker: "Participante sintético",
				reviewed: false,
			},
		],
		sync: { status: "not_configured" },
	});
	const run: LocalRunSummary = {
		...review.lineage, sourceId: review.sourceId, runId: review.runId, language: "pt",
		transcriptSha256: review.baseTranscriptSha256, transcriptSizeBytes: 1000,
		publicationTarget: null, review: null,
		stats: { ...review.stats, audioWorkSeconds: 400, sessionDurationSeconds: 100, trackCount: 4, turnCount: 1, deduplicatedSegmentCount: 0, warningCount: 0,
			processingMetrics: legacy ? null : { version: "engine_processing_v1",
				stageSeconds: { runtime_validation: 0, checkpoint_scan: 0, model_prepare: 10, model_load: 5, transcription: 20, alignment_and_energy: 0, consolidation: 0 },
				totalProcessingSeconds: 35, totalTracks: 4, freshAsrTracks: 1, textCheckpointReusedTracks: 1,
				completedCheckpointReusedTracks: 2, freshAudioWorkSeconds: 100, reusedAudioWorkSeconds: 300, freshCalibrationEligible: false } },
	};
	const comparisonLeftReview: LocalReview = {
		...review,
		persistence: "ephemeral_base",
		draftRevision: null,
		draftSha256: null,
		status: "draft",
		approvalCurrent: false,
		approvedAt: null,
		createdAt: null,
		updatedAt: null,
		segments: [
			{ trackNumber: 1, segmentId: "cmp-a-1", start: 0, end: 1, timelineStart: 5, timelineEnd: 6, text: "Mesmo começo", speaker: "Alex", reviewed: true },
			{ trackNumber: 1, segmentId: "cmp-a-2", start: 10, end: 11, timelineStart: 30, timelineEnd: 31, text: "Versão A", speaker: "Alex", reviewed: true },
			{ trackNumber: 1, segmentId: "cmp-a-3", start: 20, end: 21, timelineStart: 50, timelineEnd: 51, text: "Somente A", speaker: "Alex", reviewed: true },
		],
	};
	const comparisonRightReview: LocalReview = {
		...comparisonLeftReview,
		runId: "run-synthetic-b2",
		baseTranscriptSha256: "d".repeat(64),
		lineage: {
			...comparisonLeftReview.lineage,
			profileId: "qwen-quality",
			engine: "qwen",
			model: "Qwen3-ASR",
			modelRevision: "synthetic-r2",
			completedAt: "2026-09-26T12:05:00Z",
		},
		segments: [
			{ trackNumber: 1, segmentId: "cmp-b-1", start: 0, end: 1, timelineStart: 5.02, timelineEnd: 6.02, text: "Mesmo começo", speaker: "Alex", reviewed: true },
			{ trackNumber: 1, segmentId: "cmp-b-2", start: 10.1, end: 11.1, timelineStart: 30.1, timelineEnd: 31.1, text: "Versão B", speaker: "Bia", reviewed: true },
		],
	};
	const comparisonRunB: LocalRunSummary = {
		...run,
		runId: comparisonRightReview.runId,
		profileId: "qwen-quality",
		engine: "qwen",
		model: "Qwen3-ASR",
		modelRevision: "synthetic-r2",
		completedAt: "2026-09-26T12:05:00Z",
		transcriptSha256: comparisonRightReview.baseTranscriptSha256,
		review: { status: "reviewed", draftRevision: 2, reviewPercent: 100, updatedAt: "2026-09-26T12:06:00Z" },
		stats: {
			...run.stats,
			audioWorkSeconds: 420,
			sessionDurationSeconds: 120,
			turnCount: 3,
			trackCount: 1,
			wordCount: 6,
			segmentCount: 2,
			warningCount: 1,
		},
	};
	const otherSourceRun: LocalRunSummary = {
		...comparisonRunB,
		sourceId: `craig-${"z".repeat(64)}`,
		runId: "run-other-source",
		profileId: "other-source",
		transcriptSha256: "e".repeat(64),
	};
	async function loadSnapshot(sourceId: string, runId: string): Promise<LocalReview> {
		if (!comparisonMode) return review;
		if (sourceId !== review.sourceId) throw new Error("FIXTURE_SOURCE_MISMATCH");
		if (runId === run.runId) return comparisonLeftReview;
		if (runId === comparisonRunB.runId) return comparisonRightReview;
		throw new Error("FIXTURE_RUN_MISMATCH");
	}
	return (
		<>
        <span data-testid="save-count">{saveCount}</span>
        <span data-testid="opened-run-id" hidden>{openedRunId}</span>
        <LocalReviewWorkspace
			runs={comparisonMode ? [run, comparisonRunB, otherSourceRun] : metricsMode ? [run] : []}
			review={metricsMode ? null : review}
			busy={false}
			error={saveError}
			publicationEnabled={publication}
			comparisonEnabled={comparisonMode}
			onOpen={(_sourceId, runId) => setOpenedRunId(runId)}
			onLoadSnapshot={loadSnapshot}
			onSave={(baseline, status, segments) => {
                setSaveCount((count) => count + 1);
                setSaveError(null);
                if (new URLSearchParams(location.search).has("conflict") && baseline.draftRevision !== 2) { setSaveError("LOCAL_REVIEW_DRAFT_CONFLICT"); return; }
                setReview({ ...baseline, status, segments,
				approvalCurrent: status === "approved_local",
				approvedAt: status === "approved_local" ? "2026-09-26T12:00:01Z" : null,
				persistence: "persisted", draftRevision: (baseline.draftRevision ?? 0) + 1,
				draftSha256: "e".repeat(64), createdAt: "2026-09-26T12:00:00Z", updatedAt: "2026-09-26T12:00:00Z" }); }}
			onLoadLatest={async () => ({ ...review, draftRevision: 2, draftSha256: "f".repeat(64), status: "approved_local",
                segments: review.segments.map((segment, index) => index === 0 ? { ...segment, speaker: "Remoto" } : index === 1 ? { ...segment, text: "Fala remota" } : segment),
            })}
            onRepairTarget={new URLSearchParams(location.search).has("repair") ? () => setReview({ ...review,
                publicationTargetState: "valid", publicationTarget: {
                    campaignSlug: "yuhara-main", sourceSessionId: "sessao-synthetic",
                    jobId: "synthetic",
                    attempt: 1,
                },
            }) : undefined}
            onClose={() => {}}
			onPublish={(review, id, expected, profile) => publishApprovedLocalReview(review, id, expected, fetch, profile)}
		/>
        </>
	);
}
