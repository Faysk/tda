import { expect, test, type Page, type Route } from "@playwright/test";
import {
	installCompanionFixture,
	LOCAL_API,
	UI_ORIGIN,
} from "./companion-fixture";

const CAMPAIGN = "yuhara-main";
const SESSION = "sessao-42";
const SOURCE_SHAS = ["1".repeat(64), "2".repeat(64), "3".repeat(64)] as const;
const SOURCE_IDS = SOURCE_SHAS.map((sha) => `craig-${sha}`);
const PART_IDS = ["a".repeat(32), "b".repeat(32)] as const;
const ASSEMBLY_ID = "c".repeat(64);
const TRANSCRIPT_SHA = "d".repeat(64);
const SEGMENT_ID = "e".repeat(64);
const NOW = "2026-09-28T01:00:00.000Z";

function json(route: Route, value: unknown, status = 200) {
	return route.fulfill({
		status,
		headers: {
			"Access-Control-Allow-Origin": UI_ORIGIN,
			"Access-Control-Allow-Headers": "Authorization, Content-Type, Idempotency-Key",
			"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
			"Content-Type": "application/json",
			"Cache-Control": "no-store",
		},
		body: JSON.stringify(value),
	});
}

function runFor(sourceId: string, index: number) {
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
		transcript_sha256: index === 0 ? "6".repeat(64) : "7".repeat(64),
		transcript_size_bytes: 256,
		stats: {
			processing_seconds: 2,
			session_duration_seconds: 300,
			duration_semantics: "session_extent_v1",
			rtf: 0.01,
			word_count: 1,
			segment_count: 1,
			track_count: 1,
			turn_count: 1,
			warning_count: 0,
		},
		execution_lineage: {
			schema_version: "tda_execution_lineage_v1",
			device: "cuda",
			gpu: null,
		},
	};
}

async function installMultiRecordingRoutes(page: Page) {
	let uploadIndex = 0;
	let revision = 0;
	let expireCapabilitiesOnce = true;
	const analyzed = new Set<string>();
	let attached: string[] = [];
	const completed = new Set<string>();
	const selected = new Map<string, string>();
	let assemblyBuilt = false;
	let jobSequence = 0;
	const postedSources: string[] = [];

	const workspace = () => ({
		schema_version: "tda_session_workspace_v1",
		campaign_id: CAMPAIGN,
		session_id: SESSION,
		revision,
		ordering_mode: attached.length > 1 ? "manual" : "attachment",
		created_at: NOW,
		updated_at: NOW,
		parts: attached.map((sourceId, index) => ({
			part_id: PART_IDS[index],
			source_id: sourceId,
			ordinal: index,
			selected_run_id: selected.get(sourceId) ?? null,
			source_state: "ready",
			timeline_mode: attached.length > 1 ? "manual" : "automatic",
			session_offset_seconds: index * 300,
			trim_start_seconds: 0,
			trim_end_seconds: null,
			gap_confirmed: false,
			overlap_resolution: null,
			overlap_boundary_seconds: null,
			source_start_time: null,
			source_start_confidence: "missing",
			source_start_utc: null,
			source_duration_seconds: 300,
			effective_start_seconds: index * 300,
			effective_end_seconds: (index + 1) * 300,
			relation_to_previous: index === 0 ? "first" : "contiguous",
			relation_seconds: index === 0 ? null : 0,
			overlap_resolution_valid: true,
			created_at: NOW,
			updated_at: NOW,
		})),
		timeline: {
			policy_version: "tda_session_timeline_v1",
			segment_boundary_policy: "segment_start_owner_v1",
			fingerprint_sha256: "f".repeat(64),
			state: "ready",
			all_sources_trusted: false,
			automatic_order_available: false,
			gap_count: 0,
			overlap_count: 0,
			order_conflict_count: 0,
			unresolved_overlap_count: 0,
			unconfirmed_gap_count: 0,
		},
	});

	await page.route(`${LOCAL_API}/**`, async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		const path = url.pathname.replace("/api/v1", "");
		if (
			request.method() === "OPTIONS" &&
			(path === "/capabilities" ||
				path === "/sources/craig" ||
				path === "/jobs" ||
				path.startsWith("/session-workspaces") ||
				path === "/sources" ||
				path.startsWith("/sources/"))
		) {
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
			if (expireCapabilitiesOnce && request.headers()["authorization"]?.startsWith("Bearer ")) {
				expireCapabilitiesOnce = false;
				return json(
					route,
					{ error: { code: "UNAUTHORIZED", recoverable: true } },
					401,
				);
			}
			return json(route, {
				capabilities: [
					"transcription.craig",
					"transcription.prepare",
					"transcription.review",
					"transcription.session-workspace",
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
			const index = Math.min(uploadIndex, SOURCE_IDS.length - 1);
			const sourceId = SOURCE_IDS[index]!;
			const sourceSha = SOURCE_SHAS[index]!;
			uploadIndex += 1;
			analyzed.add(sourceId);
			return json(route, {
				schema_version: "tda_craig_ingest_v1",
				source_id: sourceId,
				source_sha256: sourceSha,
				size_bytes: 128,
				track_count: 1,
				audio_work_seconds: 300,
				session_duration_seconds: 300,
				minimum_track_duration_seconds: 300,
				reused: false,
			});
		}
		if (path === `/session-workspaces/${CAMPAIGN}/${SESSION}`) {
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
			if (attached.includes(payload.source_id))
				return json(
					route,
					{ error: { code: "SESSION_WORKSPACE_SOURCE_ALREADY_ATTACHED" } },
					409,
				);
			attached = [...attached, payload.source_id];
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
			};
			const index = PART_IDS.indexOf(payload.part_id as (typeof PART_IDS)[number]);
			if (index < 0 || !attached[index])
				return json(route, { error: { code: "SESSION_ASSEMBLY_PART_INVALID" } }, 409);
			selected.set(attached[index]!, payload.run_id);
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
		if (path === "/jobs" && request.method() === "POST") {
			const payload = request.postDataJSON() as { source_id: string };
			postedSources.push(payload.source_id);
			completed.add(payload.source_id);
			jobSequence += 1;
			return json(route, {
				id: `multi-job-${jobSequence}`,
				kind: "transcription.craig",
				status: "succeeded",
				stage: "complete",
				progress: { completed: 1, total: 1, unit: "tracks" },
				error: null,
				result_available: true,
				updated_at: NOW,
				attempt: 1,
				context: {
					campaign_id: CAMPAIGN,
					session_id: SESSION,
					source_id: payload.source_id,
					profile_id: "whisper-detailed",
				},
			});
		}
		if (path === "/jobs" && request.method() === "GET") {
			return json(route, {
				jobs: [...completed].map((sourceId, index) => ({
					id: `multi-job-${index + 1}`,
					kind: "transcription.craig",
					status: "succeeded",
					stage: "complete",
					progress: { completed: 1, total: 1, unit: "tracks" },
					error: null,
					result_available: true,
					updated_at: NOW,
					attempt: 1,
					context: {
						campaign_id: CAMPAIGN,
						session_id: SESSION,
						source_id: sourceId,
						profile_id: "whisper-detailed",
					},
				})),
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
							index === 0 ? "recording-a" : "recording-b",
						track_count: 1,
					};
				}),
			});
		}
		const runMatch = path.match(/^\/sources\/(craig-[a-f0-9]{64})\/runs$/u);
		if (runMatch && request.method() === "GET") {
			const sourceId = runMatch[1]!;
			const index = SOURCE_IDS.indexOf(sourceId);
			return json(route, {
				schema_version: "tda_transcription_runs_v1",
				source_id: sourceId,
				runs:
					index >= 0 && completed.has(sourceId) ? [runFor(sourceId, index)] : [],
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
								segment_count: 1,
								part_count: 2,
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
				segment_count: 1,
				created_at: NOW,
				parts: attached.map((sourceId, index) => ({
					part_id: PART_IDS[index],
					source_id: sourceId,
					source_sha256: SOURCE_SHAS[index],
					run_id: selected.get(sourceId),
					transcript_sha256: runFor(sourceId, index).transcript_sha256,
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
			return json(route, {
				schema_version: "tda_session_assembly_review_v1",
				snapshot_contract: "tda_session_assembly_review_cas_v1",
				persistence: "ephemeral_base",
				base: {
					kind: "session_assembly",
					assembly_id: ASSEMBLY_ID,
					transcript_sha256: TRANSCRIPT_SHA,
					inputs_sha256: ASSEMBLY_ID,
				},
				draft_revision: null,
				draft_sha256: null,
				status: "draft",
				approval_current: false,
				approval_blocked: false,
				approved_at: null,
				created_at: null,
				updated_at: null,
				review: {
					reviewed_segments: 0,
					total_segments: 1,
					review_percent: 0,
					edited_segments: 0,
					word_count: 1,
				},
				segments: [
					{
						assembly_segment_id: SEGMENT_ID,
						part_id: PART_IDS[0],
						source_id: SOURCE_IDS[0],
						run_id: "run-1",
						source_segment_id: "seg-1",
						track_number: 1,
						participant_id: "9".repeat(32),
						start: 0,
						end: 1,
						text: "Teste",
						speaker: "Renan",
						reviewed: false,
					},
				],
			});
		}
		return route.fallback();
	});

	return {
		get postedSources() {
			return [...postedSources];
		},
	};
}

test("multi-recording composer survives reload, reconnects, processes selectively and opens assembly review", async ({
	page,
}) => {
	const companion = await installCompanionFixture(page, {
		profileReady: true,
		reviewEnabled: true,
	});
	const multi = await installMultiRecordingRoutes(page);

	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await expect.poll(() => companion.sessionCount).toBeGreaterThanOrEqual(2);
	await page.getByLabel("ID da sessão").fill(SESSION);

	const input = page.getByLabel("Export do Craig");
	await input.setInputFiles({
		name: "sessao-42-parte-1.zip",
		mimeType: "application/zip",
		buffer: Buffer.from("PK-fixture-a"),
	});
	await page.getByRole("button", { name: "Analisar ZIP localmente" }).click();
	const firstAttach = page.getByRole("button", { name: "Usar composer da sessão" });
	await firstAttach.focus();
	await page.keyboard.press("Enter");
	await expect(page.getByRole("heading", { name: /sessao-42 · 1 gravação$/u })).toBeVisible();

	await input.setInputFiles({
		name: "sessao-42-parte-2.zip",
		mimeType: "application/zip",
		buffer: Buffer.from("PK-fixture-b"),
	});
	await page.getByRole("button", { name: "Analisar ZIP localmente" }).click();
	const secondAttach = page.getByRole("button", { name: /Adicionar gravação/u });
	await secondAttach.focus();
	await page.keyboard.press("Enter");
	await expect(page.getByRole("heading", { name: /sessao-42 · 2 gravações$/u })).toBeVisible();

	await page.reload();
	await expect(page.getByRole("heading", { name: /sessao-42 · 2 gravações$/u })).toBeVisible();
	await expect(page.getByLabel("ID da sessão")).toBeDisabled();

	await page.getByRole("button", { name: "Processar pendentes (2)" }).click();
	await expect.poll(() => multi.postedSources).toEqual(SOURCE_IDS.slice(0, 2));

	await page.reload();
	await expect(page.getByRole("heading", { name: /sessao-42 · 2 gravações$/u })).toBeVisible();

	const selectors = page.getByLabel("Resultado usado na sessão");
	await expect(selectors).toHaveCount(2);
	await selectors.nth(0).selectOption("run-1");
	await selectors.nth(1).selectOption("run-2");

	const build = page.getByRole("button", { name: "Montar transcrição da sessão" });
	await expect(build).toBeEnabled();
	await build.focus();
	await page.keyboard.press("Enter");

	await expect(page.getByText("Assemblies da sessão", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Abrir revisão" }).click();
	await expect(
		page.getByText(/Base da revisão carregada da assembly/u),
	).toBeVisible();

	await input.setInputFiles({
		name: "sessao-42-parte-2-variante.zip",
		mimeType: "application/zip",
		buffer: Buffer.from("PK-fixture-c"),
	});
	await page.getByRole("button", { name: "Analisar ZIP localmente" }).click();
	await expect(
		page.getByText("Variante detectada: mesmo recording_id com bytes diferentes.", {
			exact: true,
		}),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Adicionar variante mesmo assim" }),
	).toBeVisible();

	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth + 1,
		),
	).toBeTruthy();
});
