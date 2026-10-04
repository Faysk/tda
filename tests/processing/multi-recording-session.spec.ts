import { expect, test, type Page, type Route } from "@playwright/test";
import {
	installCompanionFixture,
	LOCAL_API,
	UI_ORIGIN,
} from "./companion-fixture";
import { renderTranscriptMarkdownV1 } from "../../src/features/transcript-review/markdown-contract";

const CAMPAIGN = "yuhara-main";
const SESSION = "sessao-42";
const SOURCE_SHAS = ["1".repeat(64), "2".repeat(64), "3".repeat(64), "4".repeat(64)] as const;
const SOURCE_IDS = SOURCE_SHAS.map((sha) => `craig-${sha}`);
const PART_IDS = Array.from({ length: 20 }, (_, index) =>
	(index + 1).toString(16).padStart(32, "0"),
);
const ASSEMBLY_ID = "c".repeat(64);
const TRANSCRIPT_SHA = "d".repeat(64);
const SEGMENT_ID = "e".repeat(64);
const NOW = "2026-09-30T00:00:00.000Z";

function json(route: Route, value: unknown, status = 200) {
	return route.fulfill({
		status,
		headers: {
			"Access-Control-Allow-Origin": UI_ORIGIN,
			"Access-Control-Allow-Headers":
				"Authorization, Content-Type, Idempotency-Key",
			"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
			"Content-Type": "application/json",
			"Cache-Control": "no-store",
		},
		body: JSON.stringify(value),
	});
}

function runFor(sourceId: string, index: number) {
	const digest = ((index + 6) % 16).toString(16).repeat(64);
	return {
		run_id: `run-${index + 1}`,
		status: "completed",
		source_id: sourceId,
		profile_id: "whisper-detailed",
		engine: "faster-whisper",
		model: "large-v3",
		model_revision: "fixture",
		device: "cuda",
		compute_type: "float16",
		alignment: "native",
		completed_at: NOW,
		transcript_sha256: digest,
		transcript_size_bytes: 256,
		stats: {
			audio_work_seconds: 300,
			processing_seconds: 2,
			session_duration_seconds: 300,
			duration_semantics: "session_extent_v1",
			rtf: 0.01,
			word_count: 1,
			segment_count: 1,
			track_count: 1,
			turn_count: 1,
			deduplicated_segment_count: 0,
			warning_count: 0,
		},
		execution_lineage: {
			schema_version: "tda_execution_lineage_v1",
			device: "cuda",
			gpu: null,
		},
	};
}

type FixtureOptions = Readonly<{
	uploadSequence?: readonly number[];
	recordingIds?: Readonly<Record<number, string>>;
	failOnceSourceIndex?: number | null;
	runningSourceIndex?: number | null;
	reviewAbsoluteTimes?: readonly (
		| Readonly<{ start: string; end: string }>
		| null
	)[];
	failReviewSaveOnce?: boolean;
	untrustedSourceIndexes?: readonly number[];
}>;

async function installMultiRecordingRoutes(
	page: Page,
	options: FixtureOptions = {},
) {
	let uploadIndex = 0;
	let revision = 0;
	let timelineDerived = false;
	let sequenceConfirmed = false;
	let agentOfflineOnce = false;
	let failNextSecondSourceEnqueue = false;
	const analyzed = new Set<string>();
	let attached: string[] = [];
	const selected = new Map<string, string>();
	let assemblyBuilt = false;
	let intentState: Record<string, unknown> | null = null;
	let reviewRevision: number | null = null;
	let reviewSha: string | null = null;
	let reviewStatus: "draft" | "reviewed" | "approved_local" = "draft";
	let reviewRows: Array<Record<string, unknown>> | null = null;
	let failReviewSaveOnce = options.failReviewSaveOnce ?? false;
	const publishedBodies: unknown[] = [];
	let jobSequence = 0;
	const jobsBySource = new Map<
		string,
		{ id: string; status: "queued" | "running" | "succeeded" | "failed"; attempt: number }
	>();
	const postCount = new Map<string, number>();
	const retryCount = new Map<string, number>();
	const postedSources: string[] = [];
	const postKeys = new Map<string, string[]>();
	const acceptedKeys = new Map<string, string>();
	let failedOnce = false;
	const uploadSequence = options.uploadSequence ?? [0, 1, 2];

	const baseReviewRows = () =>
		attached.map((sourceId, index) => {
			const absolute = options.reviewAbsoluteTimes?.[index];
			return {
				assembly_segment_id:
					index === 0 ? SEGMENT_ID : (index + 10).toString(16).repeat(64),
				part_id: PART_IDS[index],
				source_id: sourceId,
				run_id: `run-${SOURCE_IDS.indexOf(sourceId) + 1}`,
				source_segment_id: `seg-${index + 1}`,
				track_number: 1,
				participant_id: "9".repeat(32),
				start: index * 300,
				end: index * 300 + 1,
				...(options.reviewAbsoluteTimes === undefined
					? {}
					: absolute
						? {
								absolute_time_state: "trusted_absolute",
								absolute_start: absolute.start,
								absolute_end: absolute.end,
								absolute_time_source: sourceId,
							}
						: {
								absolute_time_state: "unavailable",
								absolute_start: null,
								absolute_end: null,
								absolute_time_source: null,
							}),
				text: `Trecho ${index + 1}`,
				speaker: "Participante",
				reviewed: false,
			};
		});
	const currentReviewRows = () => reviewRows ?? baseReviewRows();
	const reviewWordCount = () =>
		currentReviewRows().reduce((total, row) => {
			const value = typeof row.text === "string" ? row.text.trim() : "";
			return total + (value ? value.split(/\s+/u).length : 0);
		}, 0);
	const reviewResponse = (baseOnly = false) => {
		const rows = baseOnly ? baseReviewRows() : currentReviewRows();
		const persisted = !baseOnly && reviewRevision !== null;
		const reviewed = rows.filter((row) => row.reviewed === true).length;
		return {
			schema_version: "tda_session_assembly_review_v1",
			snapshot_contract: "tda_session_assembly_review_cas_v1",
			persistence: persisted ? "persisted" : "ephemeral_base",
			base: {
				kind: "session_assembly",
				assembly_id: ASSEMBLY_ID,
				transcript_sha256: TRANSCRIPT_SHA,
				inputs_sha256: ASSEMBLY_ID,
			},
			draft_revision: persisted ? reviewRevision : null,
			draft_sha256: persisted ? reviewSha : null,
			status: persisted ? reviewStatus : "draft",
			approval_current: persisted && reviewStatus === "approved_local",
			approval_blocked: false,
			approved_at:
				persisted && reviewStatus === "approved_local" ? NOW : null,
			created_at: persisted ? NOW : null,
			updated_at: persisted ? NOW : null,
			review: {
				reviewed_segments: reviewed,
				total_segments: rows.length,
				review_percent: rows.length ? (reviewed / rows.length) * 100 : 100,
				edited_segments: persisted ? 1 : 0,
				word_count: rows.reduce((total, row) => {
					const value = typeof row.text === "string" ? row.text.trim() : "";
					return total + (value ? value.split(/\s+/u).length : 0);
				}, 0),
			},
			segments: rows,
		};
	};

	const allAttachedSourcesTrusted = () =>
		attached.every(
			(sourceId) =>
				!options.untrustedSourceIndexes?.includes(SOURCE_IDS.indexOf(sourceId)),
		);
	const chronologyReady = () =>
		attached.length <= 1 || timelineDerived || sequenceConfirmed;

	const workspace = () => ({
		schema_version: "tda_session_workspace_v1",
		campaign_id: CAMPAIGN,
		session_id: SESSION,
		revision,
		ordering_mode: sequenceConfirmed
			? "confirmed_sequence"
			: timelineDerived
				? "automatic"
				: "attachment",
		created_at: NOW,
		updated_at: NOW,
		parts: attached.map((sourceId, index) => ({
			part_id: PART_IDS[index],
			source_id: sourceId,
			ordinal: index,
			selected_run_id: selected.get(sourceId) ?? null,
			source_state: "ready",
			timeline_mode: sequenceConfirmed
				? "confirmed_sequence"
				: chronologyReady()
					? "automatic"
					: "unresolved",
			session_offset_seconds: chronologyReady() ? index * 300 : null,
			trim_start_seconds: 0,
			trim_end_seconds: null,
			gap_confirmed: false,
			overlap_resolution: null,
			overlap_boundary_seconds: null,
			source_start_time: options.untrustedSourceIndexes?.includes(
				SOURCE_IDS.indexOf(sourceId),
			)
				? null
				: `2026-09-29T2${index}:00:00Z`,
			source_start_confidence: options.untrustedSourceIndexes?.includes(
				SOURCE_IDS.indexOf(sourceId),
			)
				? "missing"
				: "trusted_absolute",
			source_start_utc: options.untrustedSourceIndexes?.includes(
				SOURCE_IDS.indexOf(sourceId),
			)
				? null
				: `2026-09-29T2${index}:00:00Z`,
			source_duration_seconds: 300,
			effective_start_seconds: chronologyReady() ? index * 300 : null,
			effective_end_seconds: chronologyReady() ? (index + 1) * 300 : null,
			relation_to_previous:
				index === 0
					? "first"
					: chronologyReady()
						? "contiguous"
						: "unknown",
			relation_seconds:
				index === 0
					? null
					: chronologyReady()
						? 0
						: null,
			overlap_resolution_valid: true,
			created_at: NOW,
			updated_at: NOW,
		})),
		timeline: {
			policy_version: "tda_session_timeline_v1",
			segment_boundary_policy: "segment_start_owner_v1",
			fingerprint_sha256: "f".repeat(64),
			state: chronologyReady() ? "ready" : "needs_timing",
			all_sources_trusted: allAttachedSourcesTrusted(),
			automatic_order_available:
				attached.length > 1 &&
				allAttachedSourcesTrusted() &&
				!timelineDerived &&
				!sequenceConfirmed,
			gap_count: 0,
			overlap_count: 0,
			order_conflict_count: 0,
			unresolved_overlap_count: 0,
			unconfirmed_gap_count: 0,
		},
	});

	function jobResponse(sourceId: string) {
		const item = jobsBySource.get(sourceId);
		if (!item) throw new Error("missing fixture job");
		const index = SOURCE_IDS.indexOf(sourceId);
		return {
			id: item.id,
			kind: "transcription.craig",
			status: item.status,
			stage:
				item.status === "succeeded"
					? "complete"
					: item.status === "failed"
						? "failed"
						: item.status,
			progress:
				item.status === "succeeded"
					? { completed: 1, total: 1, unit: "tracks" }
					: item.status === "failed"
						? { completed: 0, total: 1, unit: "tracks" }
						: { completed: 0, total: 1, unit: "tracks" },
			error:
				item.status === "failed"
					? { code: "FIXTURE_TRANSCRIPTION_FAILED", recoverable: true }
					: null,
			result_available: item.status === "succeeded",
			updated_at: NOW,
			attempt: item.attempt,
			context: {
				campaign_id: CAMPAIGN,
				session_id: SESSION,
				source_id: sourceId,
				profile_id: "whisper-detailed",
			},
			execution_device: null,
			timing: {
				schema_version: "tda_job_timing_v1",
				attempt_started_at: NOW,
				attempt_finished_at: item.status === "succeeded" ? NOW : null,
				attempt_elapsed_seconds: item.status === "succeeded" ? 2 : null,
				stage_started_at: NOW,
				stage_elapsed_seconds: 2,
				tracks: [],
			},
			_fixture_index: index,
		};
	}

	await page.route(`${LOCAL_API}/**`, async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		const path = url.pathname.replace("/api/v1", "");
		if (request.method() === "OPTIONS") {
			return route.fulfill({
				status: 204,
				headers: {
					"Access-Control-Allow-Origin": UI_ORIGIN,
					"Access-Control-Allow-Headers":
						"Authorization, Content-Type, Idempotency-Key",
					"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
				},
			});
		}
		if (path === "/capabilities" && request.method() === "GET") {
			return json(route, {
				capabilities: [
					"transcription.craig",
					"transcription.prepare",
					"transcription.review",
					"transcription.session-workspace",
					"transcription.session-intent",
					"transcription.session-timeline",
					"transcription.session-participants",
					"transcription.session-assembly",
					"transcription.session-assembly.review",
					"job.events",
					"system.telemetry",
				],
				sync: false,
				device: { id: "fixture-pc", label: "PC sintético" },
				transcription: {
					profiles: ["whisper-detailed"],
					catalog: [
						{
							id: "whisper-detailed",
							engine: "whisper",
							ready: true,
							preparation_required: false,
							reason: null,
						},
					],
				},
			});
		}
		if (path === "/sources/craig" && request.method() === "POST") {
			const sequenceIndex =
				uploadSequence[Math.min(uploadIndex, uploadSequence.length - 1)] ?? 0;
			uploadIndex += 1;
			const sourceId = SOURCE_IDS[sequenceIndex]!;
			analyzed.add(sourceId);
			return json(route, {
				schema_version: "tda_craig_ingest_v1",
				source_id: sourceId,
				source_sha256: SOURCE_SHAS[sequenceIndex],
				recording_id:
					options.recordingIds?.[sequenceIndex] ??
					`recording-${sequenceIndex + 1}`,
				size_bytes: 128,
				track_count: 1,
				audio_work_seconds: 300,
				session_duration_seconds: 300,
				minimum_track_duration_seconds: 300,
				reused: false,
			});
		}
		if (
			path === `/session-workspaces/${CAMPAIGN}/${SESSION}/intent` &&
			request.method() === "POST"
		) {
			const body = request.postDataJSON() as {
				request_id: string;
				profile_id: string;
				context: string;
				glossary: string;
			};
			intentState = {
				schema_version: "tda_session_transcription_intent_v1",
				campaign_id: CAMPAIGN,
				session_id: SESSION,
				request_id: body.request_id,
				profile_id: body.profile_id,
				context: body.context,
				glossary: body.glossary,
				context_sha256: "4".repeat(64),
				glossary_sha256: "5".repeat(64),
				created_at: NOW,
				updated_at: NOW,
			};
			return json(route, intentState);
		}
		if (
			path === `/session-workspaces/${CAMPAIGN}/${SESSION}/intent` &&
			request.method() === "GET"
		) {
			return intentState
				? json(route, intentState)
				: json(
						route,
						{ error: { code: "SESSION_TRANSCRIPTION_INTENT_NOT_FOUND" } },
						404,
					);
		}

		if (path === `/session-workspaces/${CAMPAIGN}/${SESSION}`) {
			if (request.method() === "GET" && agentOfflineOnce) {
				agentOfflineOnce = false;
				return route.abort("failed");
			}
			if (request.method() === "GET") return json(route, workspace());
			if (request.method() === "POST") return json(route, workspace());
		}
		if (
			path === `/session-workspaces/${CAMPAIGN}/${SESSION}/parts` &&
			request.method() === "POST"
		) {
			const payload = request.postDataJSON() as {
				source_id: string;
				expected_revision: number;
			};
			if (payload.expected_revision !== revision)
				return json(
					route,
					{ error: { code: "SESSION_WORKSPACE_REVISION_CONFLICT" } },
					409,
				);
			if (!attached.includes(payload.source_id)) {
				attached = [...attached, payload.source_id];
				revision += 1;
				timelineDerived = false;
				sequenceConfirmed = false;
			}
			return json(route, workspace());
		}
		if (
			path ===
				`/session-workspaces/${CAMPAIGN}/${SESSION}/timeline/derive` &&
			request.method() === "POST"
		) {
			timelineDerived = true;
			revision += 1;
			return json(route, workspace());
		}
		if (
			path ===
				`/session-workspaces/${CAMPAIGN}/${SESSION}/timeline/sequence` &&
			request.method() === "POST"
		) {
			sequenceConfirmed = true;
			timelineDerived = false;
			revision += 1;
			return json(route, workspace());
		}
		if (
			path === `/session-workspaces/${CAMPAIGN}/${SESSION}/parts/run` &&
			request.method() === "POST"
		) {
			const payload = request.postDataJSON() as {
				part_id: string;
				run_id: string;
				expected_revision: number;
			};
			if (payload.expected_revision !== revision)
				return json(
					route,
					{ error: { code: "SESSION_WORKSPACE_REVISION_CONFLICT" } },
					409,
				);
			const index = PART_IDS.indexOf(payload.part_id);
			const sourceId = index >= 0 ? attached[index] : null;
			if (!sourceId)
				return json(
					route,
					{ error: { code: "SESSION_ASSEMBLY_PART_INVALID" } },
					409,
				);
			selected.set(sourceId, payload.run_id);
			revision += 1;
			return json(route, workspace());
		}
		if (
			path === `/session-workspaces/${CAMPAIGN}/${SESSION}/participants` &&
			request.method() === "GET"
		) {
			return json(route, {
				schema_version: "tda_session_participant_mapping_v1",
				policy: "strong_discord_or_manual_v1",
				campaign_id: CAMPAIGN,
				session_id: SESSION,
				workspace_revision: revision,
				mapping_sha256: "8".repeat(64),
				approval_blocked: false,
				observations: [],
				participants: [],
				conflicts: [],
				manual_assignments: [],
			});
		}
		if (path === "/sources" && request.method() === "GET") {
			return json(route, {
				schema_version: "tda_craig_sources_v1",
				sources: [...analyzed].map((sourceId) => {
					const index = SOURCE_IDS.indexOf(sourceId);
					return {
						source_id: sourceId,
						source_sha256: SOURCE_SHAS[index],
						recording_id:
							options.recordingIds?.[index] ?? `recording-${index + 1}`,
						track_count: 1,
					};
				}),
			});
		}
		if (path === "/jobs" && request.method() === "POST") {
			const payload = request.postDataJSON() as { source_id: string };
			const index = SOURCE_IDS.indexOf(payload.source_id);
			const key = request.headers()["idempotency-key"] ?? "";
			postedSources.push(payload.source_id);
			postCount.set(payload.source_id, (postCount.get(payload.source_id) ?? 0) + 1);
			postKeys.set(payload.source_id, [
				...(postKeys.get(payload.source_id) ?? []),
				key,
			]);
			const acceptedKey = acceptedKeys.get(payload.source_id);
			if (
				acceptedKey &&
				acceptedKey === key &&
				jobsBySource.has(payload.source_id)
			) {
				return json(route, jobResponse(payload.source_id));
			}
			jobSequence += 1;
			const shouldFail =
				options.failOnceSourceIndex === index && !failedOnce;
			if (shouldFail) failedOnce = true;
			jobsBySource.set(payload.source_id, {
				id: `multi-job-${jobSequence}`,
				status: shouldFail
					? "failed"
					: options.runningSourceIndex === index
						? "running"
						: "succeeded",
				attempt: 1,
			});
			acceptedKeys.set(payload.source_id, key);
			if (failNextSecondSourceEnqueue && index === 1) {
				failNextSecondSourceEnqueue = false;
				return route.abort("failed");
			}
			return json(route, jobResponse(payload.source_id));
		}
		const cancelMatch = path.match(/^\/jobs\/(multi-job-\d+)\/cancel$/u);
		if (cancelMatch && request.method() === "POST") {
			const sourceId = [...jobsBySource].find(
				([, value]) => value.id === cancelMatch[1],
			)?.[0];
			if (!sourceId)
				return json(route, { error: { code: "JOB_NOT_FOUND" } }, 404);
			const current = jobsBySource.get(sourceId)!;
			jobsBySource.set(sourceId, {
				...current,
				status: "failed",
			});
			return json(route, jobResponse(sourceId));
		}
		const retryMatch = path.match(/^\/jobs\/(multi-job-\d+)\/retry$/u);
		if (retryMatch && request.method() === "POST") {
			const sourceId = [...jobsBySource].find(
				([, value]) => value.id === retryMatch[1],
			)?.[0];
			if (!sourceId)
				return json(route, { error: { code: "JOB_NOT_FOUND" } }, 404);
			const current = jobsBySource.get(sourceId)!;
			jobsBySource.set(sourceId, {
				...current,
				status: "succeeded",
				attempt: current.attempt + 1,
			});
			retryCount.set(sourceId, (retryCount.get(sourceId) ?? 0) + 1);
			return json(route, jobResponse(sourceId));
		}
		if (path === "/jobs" && request.method() === "GET") {
			const items = [...jobsBySource.keys()].map(jobResponse);
			return json(route, {
				schema_version: "tda_job_page_v1",
				scope: url.searchParams.get("scope") ?? "all",
				jobs: items,
				has_more: false,
				next_cursor: null,
				total_matching: items.length,
				counts: {
					queued: items.filter((item) => item.status === "queued").length,
					running: items.filter((item) => item.status === "running").length,
					succeeded: items.filter((item) => item.status === "succeeded").length,
					failed: items.filter((item) => item.status === "failed").length,
					cancelled: 0,
					interrupted: 0,
				},
			});
		}
		const resultMatch = path.match(/^\/jobs\/(multi-job-\d+)\/result$/u);
		if (resultMatch && request.method() === "GET") {
			const sourceId = [...jobsBySource].find(
				([, value]) => value.id === resultMatch[1],
			)?.[0];
			if (!sourceId)
				return json(route, { error: { code: "JOB_NOT_FOUND" } }, 404);
			const index = SOURCE_IDS.indexOf(sourceId);
			const run = runFor(sourceId, index);
			return json(route, {
				schema_version: "tda_local_result_v1",
				job_id: resultMatch[1],
				campaign_id: CAMPAIGN,
				session_id: SESSION,
				source_id: sourceId,
				sync: { status: "not_configured" },
				transcription: {
					schema_version: "tda_transcript_v1",
					artifact: "transcript.json",
					sha256: run.transcript_sha256,
					run_id: run.run_id,
					profile_id: "whisper-detailed",
				},
			});
		}
		const runMatch = path.match(/^\/sources\/(craig-[a-f0-9]{64})\/runs$/u);
		if (runMatch && request.method() === "GET") {
			const sourceId = runMatch[1]!;
			const index = SOURCE_IDS.indexOf(sourceId);
			const completed = jobsBySource.get(sourceId)?.status === "succeeded";
			return json(route, {
				schema_version: "tda_transcription_runs_v1",
				source_id: sourceId,
				runs: index >= 0 && completed ? [runFor(sourceId, index)] : [],
			});
		}
		if (
			path === `/session-workspaces/${CAMPAIGN}/${SESSION}/assemblies` &&
			request.method() === "GET"
		) {
			return json(route, {
				schema_version: "tda_session_assemblies_v1",
				campaign_id: CAMPAIGN,
				session_id: SESSION,
				assemblies: assemblyBuilt
					? [
							{
								assembly_id: ASSEMBLY_ID,
								transcript_sha256: TRANSCRIPT_SHA,
								inputs_sha256: ASSEMBLY_ID,
								segment_count: attached.length,
								part_count: attached.length,
								participant_approval_blocked: false,
								created_at: NOW,
							},
						]
					: [],
			});
		}
		if (
			path === `/session-workspaces/${CAMPAIGN}/${SESSION}/assemblies` &&
			request.method() === "POST"
		) {
			assemblyBuilt = true;
			return json(route, {
				schema_version: "tda_session_assembly_v1",
				assembly_id: ASSEMBLY_ID,
				status: "completed",
				campaign_id: CAMPAIGN,
				session_id: SESSION,
				canonicalization_version: "tda_session_assembly_canonical_v1",
				inputs_sha256: ASSEMBLY_ID,
				timeline_fingerprint_sha256: "f".repeat(64),
				participant_mapping_sha256: "8".repeat(64),
				participant_approval_blocked: false,
				transcript_artifact: "transcript.json",
				transcript_sha256: TRANSCRIPT_SHA,
				transcript_size_bytes: 512,
				segment_count: attached.length,
				created_at: NOW,
				parts: attached.map((sourceId, index) => ({
					part_id: PART_IDS[index],
					source_id: sourceId,
					source_sha256: SOURCE_SHAS[SOURCE_IDS.indexOf(sourceId)],
					run_id: selected.get(sourceId),
					transcript_sha256: runFor(
						sourceId,
						SOURCE_IDS.indexOf(sourceId),
					).transcript_sha256,
					ordinal: index,
					session_offset_seconds: index * 300,
					trim_start_seconds: 0,
					trim_end_seconds: null,
					overlap_resolution: null,
					overlap_boundary_seconds: null,
				})),
			});
		}
		if (
			path ===
				`/session-workspaces/${CAMPAIGN}/${SESSION}/assemblies/${ASSEMBLY_ID}/review/base` &&
			request.method() === "GET"
		) {
			return json(route, reviewResponse(true));
		}
		if (
			path ===
				`/session-workspaces/${CAMPAIGN}/${SESSION}/assemblies/${ASSEMBLY_ID}/review` &&
			request.method() === "GET"
		) {
			return json(route, reviewResponse(false));
		}
		if (
			path ===
				`/session-workspaces/${CAMPAIGN}/${SESSION}/assemblies/${ASSEMBLY_ID}/review` &&
			request.method() === "POST"
		) {
			if (failReviewSaveOnce) {
				failReviewSaveOnce = false;
				return json(
					route,
					{ error: { code: "SESSION_ASSEMBLY_REVIEW_DRAFT_CONFLICT" } },
					409,
				);
			}
			const body = request.postDataJSON() as {
				status: "draft" | "reviewed" | "approved_local";
				segments: Array<Record<string, unknown>>;
			};
			reviewRows = body.segments.map((row) => ({ ...row }));
			reviewRevision = (reviewRevision ?? 0) + 1;
			reviewSha = (reviewRevision + 9).toString(16).repeat(64);
			reviewStatus = body.status;
			return json(route, reviewResponse(false));
		}
		return route.fallback();
	});

	await page.route(/\/api\/transcript-publications(?:\/.*)?$/u, async (route) => {
		const request = route.request();
		const path = new URL(request.url()).pathname;
		if (request.method() === "OPTIONS") return route.fulfill({ status: 204 });
		if (path === "/api/transcript-publications/current") {
			return json(route, {
				ok: true,
				current: {
					actorProfileId: "11111111-1111-4111-8111-111111111111",
					revisionId: null,
				},
			});
		}
		if (
			path === "/api/transcript-publications" ||
			path === "/api/transcript-publications/receipt"
		) {
			const body = request.postDataJSON() as Record<string, unknown>;
			publishedBodies.push(body);
			return json(route, {
				ok: true,
				receipt: {
					schemaVersion: "tda_transcript_publication_receipt_v2",
					status: "committed",
					receiptId: "22222222-2222-4222-8222-222222222222",
					campaignId: "33333333-3333-4333-8333-333333333333",
					sessionId: "44444444-4444-4444-8444-444444444444",
					revisionId: "55555555-5555-4555-8555-555555555555",
					revisionNumber: 1,
					operationId: body.operationId,
					assemblyId: ASSEMBLY_ID,
					partCount: attached.length,
					baseTranscriptSha256: TRANSCRIPT_SHA,
					draftSha256: reviewSha,
					payloadSha256: "6".repeat(64),
					segmentCount: currentReviewRows().length,
					wordCount: reviewWordCount(),
					committedAt: NOW,
				},
			});
		}
		return route.fallback();
	});

	return {
		postCount(sourceId: string) {
			return postCount.get(sourceId) ?? 0;
		},
		retryCount(sourceId: string) {
			return retryCount.get(sourceId) ?? 0;
		},
		keysFor(sourceId: string) {
			return [...(postKeys.get(sourceId) ?? [])];
		},
		get postedSources() {
			return [...postedSources];
		},
		dropAgentOnce() {
			agentOfflineOnce = true;
		},
		failNextSecondSourceEnqueue() {
			failNextSecondSourceEnqueue = true;
		},
		get attachedSources() {
			return [...attached];
		},
		get assemblyBuilt() {
			return assemblyBuilt;
		},
		get reviewStatus() {
			return reviewStatus;
		},
		get publishedBodies() {
			return [...publishedBodies];
		},
	};
}

async function openProcessing(page: Page) {
	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await page.getByLabel("ID da sessão").fill(SESSION);
}

test("single ZIP uses the same session journey and opens continuous review", async ({
	page,
}) => {
	await installCompanionFixture(page, {
		profileReady: true,
		reviewEnabled: true,
	});
	const multi = await installMultiRecordingRoutes(page, {
		uploadSequence: [0],
	});

	await openProcessing(page);
	await page.getByLabel("Export do Craig").setInputFiles({
		name: "sessao-42.zip",
		mimeType: "application/zip",
		buffer: Buffer.from("PK-single"),
	});
	await page.getByRole("button", { name: "Transcrever sessão" }).click();

	const intent = page.getByRole("region", { name: /Transcrição da sessão/u });
	await expect(intent).toContainText("Transcrição pronta");
	expect(multi.attachedSources).toEqual([SOURCE_IDS[0]]);
	expect(multi.postCount(SOURCE_IDS[0]!)).toBe(1);
	expect(multi.assemblyBuilt).toBe(true);

	await intent.getByRole("button", { name: "Revisar transcrição" }).click();
	const review = page.getByRole("region", {
		name: "Revisão da transcrição da sessão",
	});
	await expect(review).toBeVisible();
	await expect(review).toContainText("1 falas");
});

test("trusted midnight stays visible while unavailable wall-clock stays absent", async ({
	page,
}) => {
	await installCompanionFixture(page, {
		profileReady: true,
		reviewEnabled: true,
	});
	await installMultiRecordingRoutes(page, {
		uploadSequence: [0, 1],
		reviewAbsoluteTimes: [
			{
				start: "2026-09-29T23:59:59+01:00",
				end: "2026-09-30T00:00:00+01:00",
			},
			null,
		],
	});

	await openProcessing(page);
	await page.getByLabel("Export do Craig").setInputFiles([
		{
			name: "antes-da-meia-noite.zip",
			mimeType: "application/zip",
			buffer: Buffer.from("PK-midnight-a"),
		},
		{
			name: "sem-horario-confiavel.zip",
			mimeType: "application/zip",
			buffer: Buffer.from("PK-midnight-b"),
		},
	]);
	await page.getByRole("button", { name: "Transcrever sessão" }).click();
	const intent = page.getByRole("region", { name: /Transcrição da sessão/u });
	await expect(intent).toContainText("Transcrição pronta");
	await intent.getByRole("button", { name: "Revisar transcrição" }).click();

	const review = page.getByRole("region", {
		name: "Revisão da transcrição da sessão",
	});
	await expect(review.locator("time")).toHaveCount(1);
	await expect(review.locator("time")).toContainText(
		"2026-09-29 · 23:59:59 +01:00",
	);
	await expect(
		review.locator("li > :not(details)").getByText(/Track 1/iu),
	).toHaveCount(0);
	await expect(
		review.locator("details").getByText(/track 1/iu),
	).toHaveCount(2);
});

test("stale Markdown import preserves the working copy and never overwrites silently", async ({
	page,
}) => {
	await installCompanionFixture(page, {
		profileReady: true,
		reviewEnabled: true,
	});
	const multi = await installMultiRecordingRoutes(page, {
		uploadSequence: [0],
		failReviewSaveOnce: true,
	});

	await openProcessing(page);
	await page.getByLabel("Export do Craig").setInputFiles({
		name: "sessao-42.zip",
		mimeType: "application/zip",
		buffer: Buffer.from("PK-stale"),
	});
	await page.getByRole("button", { name: "Transcrever sessão" }).click();
	const intent = page.getByRole("region", { name: /Transcrição da sessão/u });
	await expect(intent).toContainText("Transcrição pronta");
	await intent.getByRole("button", { name: "Revisar transcrição" }).click();

	const review = page.getByRole("region", {
		name: "Revisão da transcrição da sessão",
	});
	await review.getByText("Markdown para revisão externa", { exact: true }).click();
	const correctedMarkdown = (
		await renderTranscriptMarkdownV1({
			base: {
				sessionId: SESSION,
				baseKind: "session_assembly",
				baseId: ASSEMBLY_ID,
				baseRevision: null,
				baseSha256: TRANSCRIPT_SHA,
			},
			segments: [
				{
					id: SEGMENT_ID,
					startMs: 0,
					endMs: 1_000,
					speaker: "Participante",
					text: "Trecho 1",
				},
			],
			title: SESSION,
			exportedAt: NOW,
		})
	).replace("Trecho 1", "Trecho 1 preservado após conflito");

	await review.locator('input[type="file"][accept*=".md"]').setInputFiles({
		name: "sessao-42-stale.md",
		mimeType: "text/markdown",
		buffer: Buffer.from(correctedMarkdown, "utf8"),
	});
	await review
		.getByRole("button", { name: "Aplicar à working copy" })
		.click();
	await expect(
		review.getByText("Trecho 1 preservado após conflito"),
	).toBeVisible();

	await review.getByRole("button", { name: "Salvar alterações" }).click();
	await expect(review.getByRole("alert")).toContainText(
		"A revisão mudou em outra aba ou processo.",
	);
	await expect(
		review.getByText("Trecho 1 preservado após conflito"),
	).toBeVisible();
	expect(multi.reviewStatus).toBe("draft");
});

test("three ZIPs become one session intent, retry only the failed recording, auto-assemble and open review", async ({
	page,
}, testInfo) => {
	await installCompanionFixture(page, {
		profileReady: true,
		reviewEnabled: true,
	});
	const multi = await installMultiRecordingRoutes(page, {
		uploadSequence: [0, 1, 2],
		failOnceSourceIndex: 2,
	});

	await openProcessing(page);
	const input = page.getByLabel("Export do Craig");
	await input.setInputFiles([
		{
			name: "sessao-42-parte-1.zip",
			mimeType: "application/zip",
			buffer: Buffer.from("PK-part-a"),
		},
		{
			name: "sessao-42-parte-2.zip",
			mimeType: "application/zip",
			buffer: Buffer.from("PK-part-b"),
		},
		{
			name: "sessao-42-parte-3.zip",
			mimeType: "application/zip",
			buffer: Buffer.from("PK-part-c"),
		},
	]);

	await expect(page.getByLabel("Gravações selecionadas").getByRole("listitem")).toHaveCount(3);
	await expect(page.getByRole("button", { name: "Transcrever sessão" })).toBeEnabled();
	await page.getByRole("button", { name: "Transcrever sessão" }).click();

	const intent = page.getByRole("region", { name: /Transcrição da sessão/u });
	await expect(intent).toBeVisible();
	await expect(intent).toContainText("2/3 concluídas");
	await expect(intent.getByRole("alert")).toContainText("Uma gravação falhou.");
	expect(multi.postCount(SOURCE_IDS[0]!)).toBe(1);
	expect(multi.postCount(SOURCE_IDS[1]!)).toBe(1);
	expect(multi.postCount(SOURCE_IDS[2]!)).toBe(1);

	await intent.getByRole("button", { name: "Reprocessar 1 gravação" }).click();
	await expect(intent).toContainText("Transcrição pronta");
	expect(multi.retryCount(SOURCE_IDS[2]!)).toBe(1);
	expect(multi.postCount(SOURCE_IDS[2]!)).toBe(1);
	expect(multi.attachedSources).toEqual(SOURCE_IDS.slice(0, 3));
	expect(multi.assemblyBuilt).toBe(true);

	await intent.getByRole("button", { name: "Revisar transcrição" }).click();
	const review = page.getByRole("region", {
		name: "Revisão da transcrição da sessão",
	});
	await expect(review).toBeVisible();
	await expect(review).toContainText("3 falas");

	await review.getByText("Markdown para revisão externa", { exact: true }).click();
	const downloadPromise = page.waitForEvent("download");
	await review
		.getByRole("button", { name: "Exportar Markdown TDA v1" })
		.click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toBe(
		"sessao-42-transcricao-tda-v1.md",
	);

	const reviewSegments = SOURCE_IDS.slice(0, 3).map((sourceId, index) => ({
		id: index === 0 ? SEGMENT_ID : (index + 10).toString(16).repeat(64),
		startMs: index * 300_000,
		endMs: index * 300_000 + 1_000,
		speaker: "Participante",
		text: `Trecho ${index + 1}`,
	}));
	const correctedMarkdown = (
		await renderTranscriptMarkdownV1({
			base: {
				sessionId: SESSION,
				baseKind: "session_assembly",
				baseId: ASSEMBLY_ID,
				baseRevision: null,
				baseSha256: TRANSCRIPT_SHA,
			},
			segments: reviewSegments,
			title: SESSION,
			exportedAt: NOW,
		})
	).replace("Trecho 1", "Trecho 1 corrigido no Markdown");

	await review.locator('input[type="file"][accept*=".md"]').setInputFiles({
		name: "sessao-42-corrigida.md",
		mimeType: "text/markdown",
		buffer: Buffer.from(correctedMarkdown, "utf8"),
	});
	await expect(
		review.getByRole("region", { name: "Prévia da importação Markdown" }),
	).toContainText("1 alteradas");
	await review
		.getByRole("button", { name: "Aplicar à working copy" })
		.click();
	await expect(review.getByText("Trecho 1 corrigido no Markdown")).toBeVisible();

	await review.getByRole("button", { name: "Salvar alterações" }).click();
	await expect.poll(() => multi.reviewStatus).toBe("reviewed");
	await review.getByRole("button", { name: "Aprovar revisão" }).click();
	await expect.poll(() => multi.reviewStatus).toBe("approved_local");
	await review
		.getByRole("button", { name: "Preparar sessão no Edit" })
		.click();
	await expect(
		review.getByRole("link", { name: "Abrir sessão no Edit" }),
	).toBeVisible();
	expect(multi.publishedBodies).toHaveLength(1);
	expect(multi.publishedBodies[0]).toMatchObject({
		schemaVersion: "tda_transcript_publication_request_v2",
		assembly: {
			assemblyId: ASSEMBLY_ID,
			parts: expect.arrayContaining([
				expect.objectContaining({ sourceId: SOURCE_IDS[0] }),
				expect.objectContaining({ sourceId: SOURCE_IDS[1] }),
				expect.objectContaining({ sourceId: SOURCE_IDS[2] }),
			]),
		},
		review: {
			status: "approved_local",
			segments: expect.arrayContaining([
				expect.objectContaining({
					assemblySegmentId: SEGMENT_ID,
					text: "Trecho 1 corrigido no Markdown",
				}),
			]),
		},
	});

	await expect(page.getByText("Detalhes técnicos", { exact: false })).toBeVisible();
	await expect(page.getByLabel("ID da sessão")).toBeDisabled();

	if (testInfo.project.name === "desktop") {
		for (const viewport of [
			{ width: 390, height: 844 },
			{ width: 1440, height: 900 },
			{ width: 1920, height: 1080 },
			// 200% zoom equivalent of the 1440×900 critical viewport.
			{ width: 720, height: 450 },
		]) {
			await page.setViewportSize(viewport);
			await expect(intent).toBeVisible();
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= window.innerWidth + 1,
				),
			).toBeTruthy();
		}
	}
});

test("mixed valid and invalid files keep independent state and valid ZIPs still run", async ({
	page,
}) => {
	await installCompanionFixture(page, {
		profileReady: true,
		reviewEnabled: true,
	});
	const multi = await installMultiRecordingRoutes(page, {
		uploadSequence: [0, 1],
	});

	await openProcessing(page);
	const input = page.getByLabel("Export do Craig");
	await input.setInputFiles([
		{
			name: "parte-a.zip",
			mimeType: "application/zip",
			buffer: Buffer.from("PK-a"),
		},
		{
			name: "notas.txt",
			mimeType: "text/plain",
			buffer: Buffer.from("nao-zip"),
		},
		{
			name: "parte-b.zip",
			mimeType: "application/zip",
			buffer: Buffer.from("PK-b"),
		},
	]);
	const list = page.getByLabel("Gravações selecionadas");
	await expect(list.getByRole("listitem")).toHaveCount(3);
	await expect(list.getByText("arquivo inválido")).toBeVisible();

	await page.getByRole("button", { name: "Transcrever sessão" }).click();
	const intent = page.getByRole("region", { name: /Transcrição da sessão/u });
	await expect(intent).toContainText("Transcrição pronta");
	expect(multi.attachedSources).toEqual(SOURCE_IDS.slice(0, 2));
});

test("exact duplicate is reused once instead of creating a second part or job", async ({
	page,
}) => {
	await installCompanionFixture(page, {
		profileReady: true,
		reviewEnabled: true,
	});
	const multi = await installMultiRecordingRoutes(page, {
		uploadSequence: [0, 0],
	});

	await openProcessing(page);
	await page.getByLabel("Export do Craig").setInputFiles([
		{
			name: "original.zip",
			mimeType: "application/zip",
			buffer: Buffer.from("PK-original"),
		},
		{
			name: "copia.zip",
			mimeType: "application/zip",
			buffer: Buffer.from("PK-copy"),
		},
	]);
	await page.getByRole("button", { name: "Transcrever sessão" }).click();
	await expect(page.getByText(/duplicata exata · será reutilizada uma vez/u)).toBeVisible();
	await expect(
		page.getByRole("region", { name: /Transcrição da sessão/u }),
	).toContainText("Transcrição pronta");
	expect(multi.attachedSources).toEqual([SOURCE_IDS[0]]);
	expect(multi.postCount(SOURCE_IDS[0]!)).toBe(1);
});

test("same Craig recording with different bytes requires an explicit decision", async ({
	page,
}) => {
	await installCompanionFixture(page, {
		profileReady: true,
		reviewEnabled: true,
	});
	const multi = await installMultiRecordingRoutes(page, {
		uploadSequence: [1, 3],
		recordingIds: {
			1: "recording-shared",
			3: "recording-shared",
		},
	});

	await openProcessing(page);
	await page.getByLabel("Export do Craig").setInputFiles([
		{
			name: "recording-export-a.zip",
			mimeType: "application/zip",
			buffer: Buffer.from("PK-variant-a"),
		},
		{
			name: "recording-export-b.zip",
			mimeType: "application/zip",
			buffer: Buffer.from("PK-variant-b"),
		},
	]);
	await page.getByRole("button", { name: "Transcrever sessão" }).click();

	const intent = page.getByRole("region", { name: /Transcrição da sessão/u });
	await expect(intent.getByRole("alert")).toContainText(
		"Encontramos duas versões da mesma gravação.",
	);
	expect(multi.attachedSources).toEqual([]);

	await intent.getByRole("button", { name: "Manter ambas" }).click();
	await expect(intent).toContainText("Transcrição pronta");
	expect(multi.attachedSources).toEqual([SOURCE_IDS[1], SOURCE_IDS[3]]);
});

test("ambiguous enqueue reuses the same idempotency identity and reconnect keeps the workspace", async ({
	page,
}) => {
	await installCompanionFixture(page, {
		profileReady: true,
		reviewEnabled: true,
	});
	const multi = await installMultiRecordingRoutes(page, {
		uploadSequence: [0, 1],
	});
	multi.failNextSecondSourceEnqueue();

	await openProcessing(page);
	await page.getByLabel("Export do Craig").setInputFiles([
		{
			name: "parte-a.zip",
			mimeType: "application/zip",
			buffer: Buffer.from("PK-a"),
		},
		{
			name: "parte-b.zip",
			mimeType: "application/zip",
			buffer: Buffer.from("PK-b"),
		},
	]);
	await page.getByRole("button", { name: "Transcrever sessão" }).click();

	const intent = page.getByRole("region", { name: /Transcrição da sessão/u });
	await expect(
		intent.getByRole("alert").filter({
			hasText: "Não foi possível confirmar a entrada desta gravação.",
		}),
	).toContainText("Não foi possível confirmar a entrada desta gravação.");
	expect(multi.postedSources).toEqual([SOURCE_IDS[0], SOURCE_IDS[1]]);
	const firstKeys = multi.keysFor(SOURCE_IDS[1] ?? "");
	expect(firstKeys).toHaveLength(1);
	expect(firstKeys[0]).not.toBe("");

	await page.reload();
	const recovered = page.getByRole("region", {
		name: /Transcrição da sessão/u,
	});
	await expect(recovered).toBeVisible();
	await expect(recovered).toContainText("Transcrição pronta");
	await expect(page.getByLabel("ID da sessão")).toHaveValue(SESSION);
	const submissionForm = page.locator("form").filter({
		has: page.getByLabel("Export do Craig"),
	});
	await expect(submissionForm.getByLabel("Perfil")).toHaveValue("whisper-detailed");
	const secondKeys = multi.keysFor(SOURCE_IDS[1] ?? "");
	expect(secondKeys).toHaveLength(2);
	expect(secondKeys[0]).toBe(secondKeys[1]);
	expect(multi.postCount(SOURCE_IDS[0] ?? "")).toBe(1);
	expect(multi.postCount(SOURCE_IDS[1] ?? "")).toBe(2);

	multi.dropAgentOnce();
	await page.waitForTimeout(2800);
	await expect(recovered).toContainText("Transcrição pronta");
});

test("cancelling one recording preserves completed siblings and retry stays selective", async ({
	page,
}) => {
	await installCompanionFixture(page, {
		profileReady: true,
		reviewEnabled: true,
	});
	const multi = await installMultiRecordingRoutes(page, {
		uploadSequence: [0, 1, 2],
		runningSourceIndex: 1,
	});

	await openProcessing(page);
	await page.getByLabel("Export do Craig").setInputFiles([
		{
			name: "parte-a.zip",
			mimeType: "application/zip",
			buffer: Buffer.from("PK-a"),
		},
		{
			name: "parte-b.zip",
			mimeType: "application/zip",
			buffer: Buffer.from("PK-b"),
		},
		{
			name: "parte-c.zip",
			mimeType: "application/zip",
			buffer: Buffer.from("PK-c"),
		},
	]);
	await page.getByRole("button", { name: "Transcrever sessão" }).click();

	const intent = page.getByRole("region", { name: /Transcrição da sessão/u });
	await expect(intent).toContainText("2/3 concluídas");
	await intent
		.getByRole("button", { name: "Cancelar parte-b.zip" })
		.click();
	await expect(intent.getByRole("alert")).toContainText("Uma gravação falhou.");
	expect(multi.postCount(SOURCE_IDS[0]!)).toBe(1);
	expect(multi.postCount(SOURCE_IDS[1]!)).toBe(1);
	expect(multi.postCount(SOURCE_IDS[2]!)).toBe(1);

	await intent.getByRole("button", { name: "Reprocessar 1 gravação" }).click();
	await expect(intent).toContainText("Transcrição pronta");
	expect(multi.retryCount(SOURCE_IDS[1]!)).toBe(1);
	expect(multi.postCount(SOURCE_IDS[0]!)).toBe(1);
	expect(multi.postCount(SOURCE_IDS[2]!)).toBe(1);
});

test("reload recovers the Agent workspace and does not expose technical controls in the happy path", async ({
	page,
}) => {
	await installCompanionFixture(page, {
		profileReady: true,
		reviewEnabled: true,
	});
	const multi = await installMultiRecordingRoutes(page, {
		uploadSequence: [0, 1],
	});

	await openProcessing(page);
	await page.getByLabel("Export do Craig").setInputFiles([
		{
			name: "parte-1.zip",
			mimeType: "application/zip",
			buffer: Buffer.from("PK-a"),
		},
		{
			name: "parte-2.zip",
			mimeType: "application/zip",
			buffer: Buffer.from("PK-b"),
		},
	]);
	await page.getByRole("button", { name: "Transcrever sessão" }).click();
	await expect(
		page.getByRole("region", { name: /Transcrição da sessão/u }),
	).toContainText("Transcrição pronta");

	await page.reload();
	const recovered = page.getByRole("region", { name: /Transcrição da sessão/u });
	await expect(recovered).toBeVisible();
	await expect(recovered).toContainText("Transcrição pronta");
	await expect(page.getByLabel("ID da sessão")).toHaveValue(SESSION);
	await expect(page.getByText("Detalhes técnicos", { exact: false })).toBeVisible();
	await expect(
		page.getByRole("button", { name: /Processar pendentes/u }),
	).not.toBeVisible();
	expect(multi.postCount(SOURCE_IDS[0]!)).toBe(1);
	expect(multi.postCount(SOURCE_IDS[1]!)).toBe(1);
});
