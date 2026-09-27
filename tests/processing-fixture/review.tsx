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
	const metricsMode = new URLSearchParams(location.search).has("metrics");
	const comparisonMode = new URLSearchParams(location.search).has("comparison");
    const [saveCount, setSaveCount] = useState(0);
	const [comparisonOpenedReview, setComparisonOpenedReview] = useState<LocalReview | null>(null);
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
		approvalCurrent: false,
		approvedAt: null,
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
	const comparisonReviewA: LocalReview = {
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
			{
				trackNumber: 1,
				segmentId: "a-1",
				start: 0,
				end: 1,
				timelineStart: 20,
				timelineEnd: 21,
				text: "A porta está aberta",
				speaker: "Alice",
				reviewed: false,
			},
		],
	};
	const comparisonReviewB: LocalReview = {
		...comparisonReviewA,
		runId: "run-synthetic-b1",
		baseTranscriptSha256: "d".repeat(64),
		lineage: {
			...comparisonReviewA.lineage,
			profileId: "qwen-quality",
			engine: "qwen3",
			model: "Qwen3-ASR",
			modelRevision: "synthetic-b",
			device: "cuda",
			computeType: "bf16",
			executionLineage: {
				schemaVersion: "tda_execution_lineage_v1",
				companionVersion: "synthetic",
				runtimeFamily: "qwen3-transformers",
				runtimeVersion: "1.0.12",
				device: "cuda",
				computeType: "bf16",
				gpu: { model: "Synthetic GPU", vramTotalBytes: 8 * 1024 ** 3 },
			},
		},
		segments: [
			{
				trackNumber: 1,
				segmentId: "b-1",
				start: 0.02,
				end: 1.02,
				timelineStart: 20.02,
				timelineEnd: 21.02,
				text: "A porta ficou aberta",
				speaker: "Alice",
				reviewed: false,
			},
		],
	};
	const comparisonRunA: LocalRunSummary = {
		...run,
		runId: comparisonReviewA.runId,
		transcriptSha256: comparisonReviewA.baseTranscriptSha256,
		profileId: comparisonReviewA.lineage.profileId,
		completedAt: "2026-09-26T12:00:00Z",
	};
	const comparisonRunB: LocalRunSummary = {
		...run,
		runId: comparisonReviewB.runId,
		transcriptSha256: comparisonReviewB.baseTranscriptSha256,
		profileId: comparisonReviewB.lineage.profileId,
		engine: comparisonReviewB.lineage.engine,
		model: comparisonReviewB.lineage.model,
		modelRevision: comparisonReviewB.lineage.modelRevision,
		device: comparisonReviewB.lineage.device,
		computeType: comparisonReviewB.lineage.computeType,
		executionLineage: comparisonReviewB.lineage.executionLineage,
		completedAt: "2026-09-26T12:05:00Z",
	};

	return (
		<>
        <span data-testid="save-count">{saveCount}</span>
        <LocalReviewWorkspace
			runs={metricsMode ? [run] : []}
			review={metricsMode ? null : review}
			busy={false}
			error={saveError}
			publicationEnabled={publication}
			comparisonEnabled={true}
			onOpen={(_sourceId, runId) => {
				if (!comparisonMode) return;
				setComparisonOpenedReview(
					runId === comparisonReviewB.runId
						? comparisonReviewB
						: comparisonReviewA,
				);
			}}
			onLoadSnapshot={async (_sourceId, runId) =>
				runId === comparisonReviewB.runId
					? comparisonReviewB
					: comparisonReviewA
			}
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
            onClose={() => {
				if (comparisonMode) setComparisonOpenedReview(null);
			}}
			onPublish={(review, id, expected, profile) => publishApprovedLocalReview(review, id, expected, fetch, profile)}
		/>
        </>
	);
}
