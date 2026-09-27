import { publishApprovedLocalReview } from "../../src/features/edit/processing/publication-client";
import { LocalReviewWorkspace } from "../../src/features/edit/processing/local-review";
import type { LocalReview, LocalRunSummary } from "../../src/features/edit/processing/protocol";
import { useMemo, useState } from "react";
import { countWordsV1 } from "../../src/features/transcript-review/text-contract";

// Synthetic browser data; the product never imports this isolated harness.
export function ReviewFixture() {
	const publication = new URLSearchParams(location.search).has("publication");
	const legacy = new URLSearchParams(location.search).has("legacy");
	const ephemeral = new URLSearchParams(location.search).has("ephemeral");
	const oldAgent = new URLSearchParams(location.search).has("old-agent");
	const bulk = new URLSearchParams(location.search).has("bulk");
	const metricsMode = new URLSearchParams(location.search).has("metrics");
	const timeline = new URLSearchParams(location.search).has("timeline");
	const large = new URLSearchParams(location.search).has("large");
	const initialSegments = useMemo<LocalReview["segments"]>(() => {
		if (large) {
			return Array.from({ length: 7_531 }, (_, index) => {
				const trackNumber = (index % 4) + 1;
				const start = index * 2;
				const offset = (trackNumber - 1) * 30;
				return {
					trackNumber,
					segmentId: `large-${index}`,
					start,
					end: start + 1,
					timelineStart: start + offset,
					timelineEnd: start + offset + 1,
					text: `Fala sintética ${index}${index === 7000 ? " exclusiva" : ""}`,
					speaker: `Participante ${trackNumber}`,
					reviewed: false,
				};
			});
		}
		if (timeline) {
			return [
				{ trackNumber: 2, segmentId: "b", start: 0, end: 2, timelineStart: 120, timelineEnd: 122, text: "Global 120", speaker: "B", reviewed: false },
				{ trackNumber: 1, segmentId: "a", start: 10, end: 12, timelineStart: 10, timelineEnd: 12, text: "Global 10", speaker: "A", reviewed: false },
				{ trackNumber: 3, segmentId: "c", start: 6, end: 8, timelineStart: 11, timelineEnd: 13, text: "Global 11", speaker: "C", reviewed: false },
			];
		}
		if (bulk) {
			return Array.from({ length: 5 }, (_, index) => ({
				trackNumber: index === 4 ? 2 : 1,
				segmentId: `s-${index}`,
				start: index,
				end: index + 1,
				text: `Fala ${index}`,
				speaker: index === 3 ? "Convidado" : "Alex",
				reviewed: true,
			}));
		}
		return [{
			trackNumber: 1,
			segmentId: "1-0",
			start: 0,
			end: 1,
			text: "Olá\u0085mundo",
			speaker: "Participante sintético",
			reviewed: false,
		}];
	}, [bulk, large, timeline]);
    const [saveCount, setSaveCount] = useState(0);
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
			audioWorkSeconds: large ? 21_600 : 60,
			processingSeconds: 30,
			sessionDurationSeconds: large ? 21_600 : timeline ? 122 : 60,
			rtf: 0.5,
			wordCount: initialSegments.reduce((total, segment) => total + countWordsV1(segment.text), 0),
			segmentCount: initialSegments.length,
			trackCount: large ? 4 : timeline ? 3 : bulk ? 2 : 1,
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
			reviewedSegments: initialSegments.filter((segment) => segment.reviewed).length,
			totalSegments: initialSegments.length,
			reviewPercent: initialSegments.length
				? (initialSegments.filter((segment) => segment.reviewed).length / initialSegments.length) * 100
				: 100,
			editedSegments: 0,
			wordCount: initialSegments.reduce((total, segment) => total + countWordsV1(segment.text), 0),
			warningCount: legacy ? 1000 : 5000,
		},
		segments: initialSegments,
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
	return (
		<>
        <span data-testid="save-count">{saveCount}</span>
        <LocalReviewWorkspace
			runs={metricsMode ? [run] : []}
			review={metricsMode ? null : review}
			busy={false}
			error={saveError}
			publicationEnabled={publication}
			onOpen={() => {}}
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
