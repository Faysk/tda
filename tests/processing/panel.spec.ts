import { expect, test } from "@playwright/test";
import {
	CRAIG_SOURCE_ID,
	failedJob,
	fixtureBenchmarkJob,
	fixtureJob,
	installCompanionFixture,
	LOCAL_API,
	UI_ORIGIN,
} from "./companion-fixture";

test("cockpit follows the newest track in the active attempt", async ({ page }) => {
	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: [fixtureJob("running")],
		jobEvents: [
			{ seq: 1, attempt: 1, code: "TRACK_STARTED", at: "2026-10-07T13:00:00Z", level: "info", data: { track: 1, total_tracks: 4, speaker: "Alice" } },
			{ seq: 2, attempt: 1, code: "TRACK_STARTED", at: "2026-10-07T13:01:00Z", level: "info", data: { track: 2, total_tracks: 4, speaker: "Bruno" } },
		],
	});
	await page.goto("/");
	await expect(page.getByText("Arquivo 2 de 4", { exact: true })).toBeVisible();
	await expect(page.getByText("Voz: Bruno", { exact: true })).toBeVisible();
	await expect(page.getByText("Voz: Alice", { exact: true })).toHaveCount(0);
});

function fulfillJson(
	route: import("@playwright/test").Route,
	value: unknown,
	status = 200,
) {
	return route.fulfill({
		status,
		headers: {
			"Access-Control-Allow-Origin": UI_ORIGIN,
			"Access-Control-Allow-Headers":
				"Authorization, Content-Type, Idempotency-Key",
			"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
			"Content-Type": "application/json",
		},
		body: JSON.stringify(value),
	});
}

async function installRecoveredPendingSession(
	page: import("@playwright/test").Page,
) {
	const workspace = {
		schema_version: "tda_session_workspace_v1",
		campaign_id: "yuhara-main",
		session_id: "sessao-42",
		revision: 1,
		ordering_mode: "attachment",
		created_at: "2026-10-03T03:00:00.000Z",
		updated_at: "2026-10-03T03:00:00.000Z",
		parts: [
			{
				part_id: "1".repeat(32),
				source_id: CRAIG_SOURCE_ID,
				ordinal: 0,
				selected_run_id: null,
				source_state: "ready",
				timeline_mode: "automatic",
				session_offset_seconds: 0,
				trim_start_seconds: 0,
				trim_end_seconds: null,
				gap_confirmed: false,
				overlap_resolution: null,
				overlap_boundary_seconds: null,
				source_start_time: null,
				source_start_confidence: "missing",
				source_start_utc: null,
				source_duration_seconds: 300,
				effective_start_seconds: 0,
				effective_end_seconds: 300,
				relation_to_previous: "first",
				relation_seconds: null,
				overlap_resolution_valid: true,
				physical_interval_state: "first",
				created_at: "2026-10-03T03:00:00.000Z",
				updated_at: "2026-10-03T03:00:00.000Z",
			},
		],
		timeline: {
			policy_version: "tda_session_timeline_v2",
			segment_boundary_policy: "segment_start_owner_v1",
			fingerprint_sha256: "2".repeat(64),
			strategy: "trusted_absolute",
			wall_clock: "unavailable",
			unknown_interval_count: 0,
			state: "ready",
			all_sources_trusted: false,
			automatic_order_available: false,
			gap_count: 0,
			overlap_count: 0,
			order_conflict_count: 0,
			unresolved_overlap_count: 0,
			unconfirmed_gap_count: 0,
		},
	};
	await page.route(
		`${LOCAL_API}/session-workspaces/yuhara-main/sessao-42`,
		(route) => fulfillJson(route, workspace),
	);
	await page.route(
		`${LOCAL_API}/session-workspaces/yuhara-main/sessao-42/participants`,
		(route) =>
			fulfillJson(route, {
				schema_version: "tda_session_participant_mapping_v1",
				policy: "strong_discord_or_manual_v1",
				campaign_id: "yuhara-main",
				session_id: "sessao-42",
				workspace_revision: 1,
				mapping_sha256: "3".repeat(64),
				approval_blocked: false,
				observations: [],
				participants: [],
				conflicts: [],
				manual_assignments: [],
			}),
	);
	await page.route(
		`${LOCAL_API}/session-workspaces/yuhara-main/sessao-42/assemblies`,
		(route) =>
			fulfillJson(route, {
				schema_version: "tda_session_assemblies_v1",
				campaign_id: "yuhara-main",
				session_id: "sessao-42",
				assemblies: [],
			}),
	);
	await page.route(`${LOCAL_API}/sources/${CRAIG_SOURCE_ID}/runs`, (route) =>
		fulfillJson(route, {
			schema_version: "tda_transcription_runs_v1",
			source_id: CRAIG_SOURCE_ID,
			runs: [],
		}),
	);
	await page.route(
		/^http:\/\/127\.0\.0\.1:8765\/api\/v1\/jobs(?:\?.*)?$/u,
		(route) =>
			fulfillJson(route, {
				schema_version: "tda_job_page_v1",
				scope: "all",
				jobs: [],
				has_more: false,
				next_cursor: null,
				total_matching: 0,
				counts: {},
			}),
	);
}


async function installCompletedRunCatalog(
	page: import("@playwright/test").Page,
	runCountOrOptions:
		| number
		| Readonly<{
				runCount?: number;
				runId?: string;
				profileId?: "whisper-detailed" | "qwen-quality";
				engine?: string;
				model?: string;
				transcriptSha256?: string;
				publicationTarget?: string | null;
		  }> = 1,
) {
	const options =
		typeof runCountOrOptions === "number"
			? { runCount: runCountOrOptions }
			: runCountOrOptions;
	const runCount = options.runCount ?? 1;
	await page.route(`${LOCAL_API}/sources`, (route) =>
		fulfillJson(route, {
			schema_version: "tda_craig_sources_v1",
			sources: [
				{
					source_id: CRAIG_SOURCE_ID,
					source_sha256: "a".repeat(64),
					recording_id: null,
					track_count: 2,
				},
			],
		}),
	);
	await page.route(`${LOCAL_API}/sources/${CRAIG_SOURCE_ID}/runs`, (route) =>
		fulfillJson(route, {
			schema_version: "tda_transcription_runs_v1",
			source_id: CRAIG_SOURCE_ID,
			runs: Array.from({ length: runCount }, (_, index) => {
				const profileId =
					index === 0 && options.profileId
						? options.profileId
						: index % 2
							? "whisper-turbo"
							: "whisper-detailed";
				return {
					run_id:
						index === 0 && options.runId
							? options.runId
							: `run-results-${String(index + 1).padStart(2, "0")}`,
					status: "completed",
					source_id: CRAIG_SOURCE_ID,
					profile_id: profileId,
					engine:
						index === 0 && options.engine
							? options.engine
							: profileId === "qwen-quality"
								? "qwen3"
								: "faster-whisper",
					model:
						index === 0 && options.model
							? options.model
							: profileId === "qwen-quality"
								? "fixture-qwen"
								: index % 2
									? "turbo"
									: "large-v3",
					model_revision: "rev",
					device: "cuda",
					completed_at: new Date(Date.UTC(2026, 8, 27, 18, index)).toISOString(),
					transcript_sha256:
						index === 0 && options.transcriptSha256
							? options.transcriptSha256
							: (index % 16).toString(16).repeat(64),
					transcript_size_bytes: 900 + index,
					stats: {
						processing_seconds: 12 + index,
						session_duration_seconds: 60 + index,
						duration_semantics: "session_extent_v1",
						rtf: 0.2,
						word_count: 2 + index,
						segment_count: 1 + index,
						track_count: 1,
						turn_count: 1 + index,
						warning_count: 0,
					},
					execution_lineage: {
						schema_version: "tda_execution_lineage_v1",
						device: "cuda",
						gpu: { model: "Synthetic GPU", vram_total_bytes: 8589934592 },
					},
					publication_target:
						options.publicationTarget === null
							? null
							: {
									schema_version: "tda_publication_target_v1",
									campaign_slug: options.publicationTarget ?? "yuhara-main",
									source_session_id: "sessao-42",
									job_id: `job-results-${String(index + 1).padStart(2, "0")}`,
									attempt: 1,
									source_id: CRAIG_SOURCE_ID,
									run_id:
										index === 0 && options.runId
											? options.runId
											: `run-results-${String(index + 1).padStart(2, "0")}`,
									transcript_sha256:
										index === 0 && options.transcriptSha256
											? options.transcriptSha256
											: (index % 16).toString(16).repeat(64),
								},
				};
			}),
		}),
	);
}

test("troca de campaign com trabalho autoritativo exige confirmação e não retaggeia o job", async ({ page }, testInfo) => {
	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: [fixtureJob("running")],
	});

	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	const selector = page.getByRole("button", {
		name: "Trocar campanha do processamento",
	});
	await expect(selector).toContainText("Crônicas da Mesa");

	await selector.click();
	const alternateCampaign = page
		.getByRole("option")
		.filter({ hasNotText: "Crônicas da Mesa" })
		.first();
	await expect(alternateCampaign).toBeVisible();
	await alternateCampaign.click();

	const confirmation = page.getByRole("dialog", { name: "Trocar de campanha?" });
	await expect(confirmation).toBeVisible();
	await expect(confirmation).toContainText("Crônicas da Mesa");
	await expect(confirmation).toContainText("Antes que seja tarde");
	await expect(confirmation).toContainText(
		"Trabalhos já enfileirados ou em execução continuam associados à campanha original.",
	);
	await expect(
		confirmation.getByRole("button", { name: "Continuar nesta campanha" }),
	).toBeFocused();
	await page.screenshot({
		path: testInfo.outputPath("issue-1354-campaign-switch-fixture.png"),
		fullPage: false,
	});

	await page.keyboard.press("Escape");
	await expect(confirmation).toBeHidden();
	await expect(selector).toContainText("Crônicas da Mesa");
	await expect(page).toHaveURL("/");

	await selector.click();
	await expect(alternateCampaign).toBeVisible();
	await alternateCampaign.click();
	await expect(confirmation).toBeVisible();
	await confirmation.getByRole("button", { name: "Continuar nesta campanha" }).click();
	await expect(confirmation).toBeHidden();
	await expect(selector).toContainText("Crônicas da Mesa");
	await expect(page).toHaveURL("/");
});

test("workspace não expõe nem oferece ações para jobs de outra campaign", async ({
	page,
}) => {
	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: [
			fixtureJob("queued"),
			fixtureJob("running", {
				id: "campaign-b-job",
				context: {
					campaign_id: "campaign-b",
					session_id: "sessao-privada-b",
					source_id: CRAIG_SOURCE_ID,
					profile_id: "qwen-quality",
				},
			}),
		],
	});

	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	const commandBar = page.getByRole("region", {
		name: "Estado e comandos do TDA Companion",
	});
	await expect(commandBar).toContainText("0 processando");
	await expect(commandBar).toContainText("1 na fila");
	await expect(page.getByText("sessao-privada-b", { exact: false })).toHaveCount(0);

	await page.getByRole("tab", { name: "Fila" }).click();
	await expect(page.getByText("sessao-privada-b", { exact: false })).toHaveCount(0);
	await expect(page.locator('[data-job-id="campaign-b-job"]')).toHaveCount(0);
});

test("API incompatível, versão antiga, offline e Origin negada são diagnósticos distintos", async ({
	page,
}, testInfo) => {
	const requests: { url: string; authorization?: string }[] = [];
	await page.route(`${LOCAL_API}/**`, async (route) => {
		requests.push({
			url: route.request().url(),
			authorization: route.request().headers().authorization,
		});
		return fulfillJson(route, {
			api_version: "2",
			service_version: "0.3.99",
			lifecycle: "ready",
		});
	});
	await page.goto("/");
	await expect(page.getByText("API incompatível", { exact: true })).toBeVisible();
	await expect(page.getByRole("alert")).toContainText("API v2");
	await page.screenshot({
		path: testInfo.outputPath("overview-error.png"),
		fullPage: true,
	});
	expect(requests).toHaveLength(1);
	expect(requests[0]?.authorization).toBeUndefined();

	await page.unroute(`${LOCAL_API}/**`);
	await page.route(`${LOCAL_API}/**`, (route) =>
		fulfillJson(route, {
			api_version: "1",
			service_version: "0.3.13",
			lifecycle: "ready",
		}),
	);
	await page.getByRole("button", { name: "Tentar novamente" }).click();
	await expect(
		page.getByText("Atualização necessária", { exact: true }),
	).toBeVisible();
	await expect(page.getByRole("alert")).toContainText("v0.3.13");
	await expect(page.getByRole("alert")).toContainText("v0.3.14");

	await page.unroute(`${LOCAL_API}/**`);
	await page.route(`${LOCAL_API}/**`, (route) => route.abort("failed"));
	await page.getByRole("button", { name: "Tentar novamente" }).click();
	await expect(page.getByRole("alert")).toContainText(
		"permissão de acesso à rede local",
	);
	await expect(page.getByRole("alert")).toContainText("Código: unreachable");

	await page.unroute(`${LOCAL_API}/**`);
	await page.route(`${LOCAL_API}/**`, async (route) => {
		const path = new URL(route.request().url()).pathname;
		if (path.endsWith("/health")) {
			return fulfillJson(route, {
				api_version: "1",
				service_version: "0.3.14",
				lifecycle: "ready",
			});
		}
		return fulfillJson(
			route,
			{ error: { code: "ORIGIN_REJECTED", recoverable: false } },
			403,
		);
	});
	await page.getByRole("button", { name: "Tentar novamente" }).click();
	await expect(page.getByRole("alert")).toContainText("ORIGIN_REJECTED");
});

test("sessão browser expirada é renovada automaticamente", async ({ page }) => {
	const state = await installCompanionFixture(page, {
		profileReady: true,
		expireBrowserSessionOnce: true,
	});

	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	expect(state.sessionCount).toBeGreaterThanOrEqual(2);
	expect(
		state.requests.filter((request) => request.path === "/session").length,
	).toBeGreaterThanOrEqual(2);
	expect(
		await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
	).toBe(true);
});

test("recovery separates a previous Companion outage from current readiness without duplicating the alert", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.addInitScript(() => {
		window.localStorage.setItem(
			"tda.processing.session-composer.recovery.v2:yuhara-main",
			"sessao-42",
		);
	});
	await installCompanionFixture(page, {
		profileReady: true,
		serviceVersion: "0.3.16",
		advanceJobs: false,
		additionalCapabilities: [
			"transcription.session-workspace",
			"transcription.session-intent",
			"transcription.session-timeline",
			"transcription.session-participants",
			"transcription.session-assembly",
			"transcription.session-assembly.review",
		],
	});
	await installRecoveredPendingSession(page);

	let offline = false;
	await page.route(`${LOCAL_API}/**`, (route) =>
		offline ? route.abort("failed") : route.fallback(),
	);

	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	const sessionProgress = page
		.locator("[data-session-intent='true']")
		.getByText("0/1 concluída", { exact: true });
	await expect(sessionProgress).toBeVisible();
	await expect(
		page.getByText("A sessão foi recuperada do Companion.", { exact: true }),
	).toBeVisible();
	await expect(
		page.getByText(/Selecione novamente os ZIPs para retomar sem mover ou duplicar/u),
	).toBeVisible();

	const technicalSummary = page
		.locator("details > summary")
		.filter({ hasText: "Detalhes técnicos" })
		.first();
	await technicalSummary.click();
	const technical = technicalSummary.locator("..");

	offline = true;
	await technical.getByRole("button", { name: "Atualizar", exact: true }).click();

	const previousOutage = page.getByRole("alert").filter({
		hasText: "O Companion ficou indisponível. O estado já salvo foi preservado.",
	});
	await expect(previousOutage).toHaveCount(1);
	await expect(
		page.locator("[data-processing-recovery-history='true']"),
	).toHaveCount(0);
	await expect(sessionProgress).toBeVisible();

	offline = false;
	await page.evaluate(() => {
		document.dispatchEvent(new Event("visibilitychange"));
	});

	const history = page.locator("[data-processing-recovery-history='true']");
	await expect(history).toBeVisible();
	await expect(history).toContainText(
		"Na tentativa anterior, o Companion ficou indisponível.",
	);
	await expect(history).toContainText(
		"só gravações com execução confirmada contam como concluídas",
	);
	await expect(history).toContainText(
		"Se o ZIP original não estiver selecionado, escolha o mesmo arquivo para retomar.",
	);
	await expect(previousOutage).toHaveCount(0);
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await expect(sessionProgress).toBeVisible();

	await technical.getByRole("button", { name: "Atualizar", exact: true }).click();
	await expect(
		page.getByText("Composer da sessão recarregado.", { exact: true }).first(),
	).toBeVisible();

	for (const width of [390, 320]) {
		await page.setViewportSize({ width, height: 844 });
		await expect(history).toBeVisible();
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth + 1,
			),
		).toBe(true);
		await expect(sessionProgress).toBeVisible();
	}

	offline = true;
	await page.evaluate(() => {
		document.dispatchEvent(new Event("visibilitychange"));
	});
	await expect(history).toHaveCount(0);
	await expect(
		page.getByRole("alert").filter({
			hasText: "Não foi possível alcançar o Companion local.",
		}),
	).toHaveCount(1);
});


test("cancelamento exige confirmação e converge para cancelled", async ({ page }) => {
	const state = await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: [fixtureJob("running")],
	});

	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await expect(page.getByText("Processando", { exact: true }).first()).toBeVisible();

	await page.getByRole("button", { name: "Cancelar trabalho" }).first().click();
	await expect(page.getByRole("dialog")).toContainText("craig-job-1");
	expect(
		state.requests.filter((request) => request.path.endsWith("/cancel")),
	).toHaveLength(0);
	await page.getByRole("button", { name: "Confirmar", exact: true }).click();

	await expect
		.poll(() => state.job?.status)
		.toBe("cancelled");
	await page.getByRole("tab", { name: "Fila" }).click();
	await page.getByRole("button", { name: "Cancelados" }).click();
	const queuePanel = page.getByRole("tabpanel", { name: "Fila" });
	await expect(
		queuePanel
			.locator('td[data-label="Estado"]')
			.getByText("Cancelado", { exact: true }),
	).toBeVisible();
});

test("ações locais e refresh não emitem loading global dentro da workspace", async ({ page }) => {
	const state = await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: [fixtureJob("running")],
		jobReadDelayMs: 800,
	});
	await page.addInitScript(() => {
		const starts: string[] = [];
		(window as Window & { __globalLoadingStarts?: string[] }).__globalLoadingStarts = starts;
		window.addEventListener("tda:global-loading-start", (event) => {
			const detail = (event as CustomEvent<{ id?: string }>).detail;
			starts.push(detail?.id ?? "unknown");
		});
	});

	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();

	await page.getByRole("button", { name: "Atualizar estado" }).click();
	await expect(page.getByRole("button", { name: "Atualizando…" })).toBeVisible();

	await page.getByRole("button", { name: "Cancelar trabalho" }).first().click();
	await page.getByRole("button", { name: "Confirmar", exact: true }).click();

	await expect.poll(() => state.job?.status).toBe("cancelled");
	expect(
		await page.evaluate(
			() =>
				(window as Window & { __globalLoadingStarts?: string[] })
					.__globalLoadingStarts ?? [],
		),
	).toEqual([]);
});

test("refresh atrasado mantém ação do job clicável e não regride o estado novo", async ({ page }) => {
	const state = await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: [fixtureJob("running")],
		jobReadDelayMs: 800,
	});

	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();

	const refresh = page.getByRole("button", { name: "Atualizar estado" });
	const cancel = page.getByRole("button", { name: "Cancelar trabalho" }).first();
	await refresh.click();
	await expect(page.getByRole("button", { name: "Atualizando…" })).toBeVisible();
	await expect(cancel).toBeEnabled();

	await cancel.click();
	await expect(page.getByRole("dialog")).toContainText("craig-job-1");
	await page.getByRole("button", { name: "Confirmar", exact: true }).click();

	await expect.poll(() => state.job?.status).toBe("cancelled");
	await page.getByRole("tab", { name: "Fila" }).click();
	await page.getByRole("button", { name: "Cancelados" }).click();
	const queuePanel = page.getByRole("tabpanel", { name: "Fila" });
	await expect(
		queuePanel
			.locator('td[data-label="Estado"]')
			.getByText("Cancelado", { exact: true }),
	).toBeVisible();
});

test("atenção na command bar abre a fila já focada no problema", async ({ page }) => {
	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: [failedJob()],
		system: {
			gpus: [
				{
					index: 0,
					name: "Synthetic GPU",
					utilizationPercent: 25,
					memoryUsedBytes: 4 * 1024 ** 3,
					memoryTotalBytes: 8 * 1024 ** 3,
				},
			],
		},
	});

	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "Fila" }).click();
	await page.getByLabel("Buscar").fill("busca-antiga-sem-match");
	await page.getByRole("tab", { name: "Visão geral" }).click();
	await page.getByRole("button", { name: "1 atenção", exact: true }).click();

	await expect(page.getByLabel("Buscar")).toHaveValue("");
	await expect(page.getByRole("tab", { name: "Fila" })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(
		page.getByRole("button", { name: "Atenção", exact: true }),
	).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await expect(
		page
			.getByRole("tabpanel", { name: "Fila" })
			.locator('td[data-label="Estado"]')
			.getByText("Falhou", { exact: true }),
	).toBeVisible();
});

test("Overview attention exposes New, safe Retry, Diagnostics and Discard without conflating them", async ({
	page,
}) => {
	const state = await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: [failedJob()],
	});

	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	const overview = page.getByRole("tabpanel", { name: "Visão geral" });
	const attention = overview.getByRole("region", { name: "Precisa de atenção" });

	await expect(attention).toBeVisible();
	await expect(attention).toContainText("QWEN_ALIGNMENT_REQUIRED");
	await expect(
		attention.getByRole("button", { name: "Nova transcrição" }),
	).toBeVisible();
	await expect(
		attention.getByRole("button", { name: "Repetir trabalho" }),
	).toBeVisible();
	await expect(
		attention.getByRole("button", { name: "Diagnóstico" }),
	).toBeVisible();
	await expect(
		attention.getByRole("button", { name: "Descartar trabalho" }),
	).toBeVisible();

	await attention.getByRole("button", { name: "Diagnóstico" }).click();
	const inspector = page.locator("dialog[data-job-diagnostics='contextual']");
	await expect(inspector).toBeVisible();
	await expect(
		inspector.getByRole("button", { name: "Nova transcrição" }),
	).toBeVisible();
	await expect(
		inspector.getByRole("button", { name: "Repetir trabalho" }),
	).toBeVisible();
	await expect(
		inspector.getByRole("button", { name: "Descartar trabalho" }),
	).toBeVisible();

	const retryRequestsBefore = state.requests.filter((request) =>
		request.path.endsWith("/retry"),
	).length;
	await inspector.getByRole("button", { name: "Nova transcrição" }).click();
	await expect(inspector).not.toBeVisible();
	await expect(page.getByRole("tab", { name: "Visão geral" })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	expect(
		state.requests.filter((request) => request.path.endsWith("/retry")).length,
	).toBe(retryRequestsBefore);

	await attention.getByRole("button", { name: "Descartar trabalho" }).click();
	const discardDialog = page
		.getByRole("dialog")
		.filter({ hasText: "Descartar este trabalho?" });
	await expect(discardDialog).toBeVisible();
	await expect(discardDialog).toContainText(
		"Nenhum resultado concluído será removido",
	);
	await discardDialog.getByRole("button", { name: "Descartar trabalho" }).click();

	await expect
		.poll(
			() =>
				state.requests.filter(
					(request) =>
						request.method === "POST" &&
						request.path === "/jobs/craig-job-1/delete",
				).length,
		)
		.toBe(1);
	await expect(attention).toHaveCount(0);
});

test("non-recoverable Overview attention never offers Retry as a recovery shortcut", async ({
	page,
}) => {
	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: [
			failedJob({
				error: { code: "WORKER_PROGRESS_GAP", recoverable: false },
			}),
		],
	});

	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	const overview = page.getByRole("tabpanel", { name: "Visão geral" });
	const attention = overview.getByRole("region", { name: "Precisa de atenção" });

	await expect(attention).toBeVisible();
	await expect(
		attention.getByRole("button", { name: "Nova transcrição" }),
	).toBeVisible();
	await expect(
		attention.getByRole("button", { name: "Repetir trabalho" }),
	).toHaveCount(0);
	await expect(
		attention.getByRole("button", { name: "Descartar trabalho" }),
	).toBeVisible();

	await attention.getByRole("button", { name: "Diagnóstico" }).click();
	const inspector = page.locator("dialog[data-job-diagnostics='contextual']");
	await expect(inspector).toBeVisible();
	await expect(inspector).toContainText("WORKER_PROGRESS_GAP");
	await expect(
		inspector.getByRole("button", { name: "Repetir trabalho" }),
	).toHaveCount(0);
	await expect(
		inspector.getByRole("button", { name: "Nova transcrição" }),
	).toBeVisible();
	const discard = inspector.getByRole("button", { name: "Descartar trabalho" });
	await expect(discard).toBeVisible();
	await discard.click();
	await expect(inspector).not.toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Descartar este trabalho?" }),
	).toBeVisible();
	await page.getByRole("button", { name: "Voltar" }).click();
});

test("telemetry stale preserva o último snapshot e orienta sem zerar valores", async ({ page }) => {
	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: [fixtureJob("running")],
		system: {
			gpus: [
				{
					index: 0,
					name: "Synthetic GPU",
					utilizationPercent: 61,
					memoryUsedBytes: 5 * 1024 ** 3,
					memoryTotalBytes: 8 * 1024 ** 3,
				},
			],
		},
	});
	let reads = 0;
	await page.route(`${LOCAL_API}/system`, async (route) => {
		reads += 1;
		if (reads > 1) return route.abort("failed");
		return route.fallback();
	});

	await page.goto("/");
	const commandBar = page.getByRole("region", {
		name: "Estado e comandos do TDA Companion",
	});
	await expect(commandBar).toContainText("Synthetic GPU · 61% · 5.0/8.0 GB");

	await page.getByRole("button", { name: "Atualizar estado" }).click();

	await expect(commandBar).toContainText("Dados desatualizados");
	await expect(commandBar).toContainText("O último snapshot válido foi preservado.");
	await expect(commandBar).toContainText("Synthetic GPU · 61% · 5.0/8.0 GB");
	await expect(commandBar).not.toContainText("Synthetic GPU · 0%");
});

test("telemetry visual bridge follows active and idle polling cadence while AT sees the factual target", async ({ page }, testInfo) => {
	const state = await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: [fixtureJob("running")],
		system: {
			cpuPercent: 3,
			memoryPercent: 3,
			gpus: [
				{
					index: 0,
					name: "Synthetic GPU",
					utilizationPercent: 3,
					memoryUsedBytes: 3 * 1024 ** 3,
					memoryTotalBytes: 8 * 1024 ** 3,
				},
			],
		},
	});

	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();

	const commandBar = page.getByRole("region", {
		name: "Estado e comandos do TDA Companion",
	});
	const gpuMetric = commandBar.locator(
		'[data-animated-metric="true"][data-metric-label="Uso da GPU"]',
	);
	await expect(gpuMetric).toHaveAttribute("data-animated-sample-ms", "1500");
	await expect(gpuMetric.locator("meter")).toHaveAttribute("value", "3");

	state.setSystem({
		cpuPercent: 67,
		memoryPercent: 67,
		gpus: [
			{
				index: 0,
				name: "Synthetic GPU",
				utilizationPercent: 67,
				memoryUsedBytes: 6 * 1024 ** 3,
				memoryTotalBytes: 8 * 1024 ** 3,
			},
		],
	});
	await page.getByRole("button", { name: "Atualizar estado" }).click();

	await expect(gpuMetric).toHaveAttribute("data-animated-sample-ms", "1500");
	await expect(gpuMetric).toHaveAttribute("data-animated-target", "67");
	await expect(gpuMetric).toHaveAttribute("data-animated-running", "true");
	await expect(gpuMetric.locator("meter")).toHaveAttribute("value", "67");
	await expect(gpuMetric.locator("meter")).toHaveAttribute("aria-valuetext", "67%");
	await page.screenshot({
		path: testInfo.outputPath("telemetry-bridge-active.png"),
		fullPage: true,
	});

	state.setJob(null);
	state.setSystem({
		cpuPercent: 46,
		memoryPercent: 46,
		gpus: [
			{
				index: 0,
				name: "Synthetic GPU",
				utilizationPercent: 46,
				memoryUsedBytes: 5 * 1024 ** 3,
				memoryTotalBytes: 8 * 1024 ** 3,
			},
		],
	});
	await page.getByRole("button", { name: "Atualizar estado" }).click();

	await expect(gpuMetric).toHaveAttribute("data-animated-sample-ms", "6000");
	await expect(gpuMetric).toHaveAttribute("data-animated-target", "46");
	await expect(gpuMetric).toHaveAttribute("data-animated-running", "true");
	await expect(gpuMetric.locator("meter")).toHaveAttribute("value", "46");
	await expect(gpuMetric.locator("meter")).toHaveAttribute("aria-valuetext", "46%");
	await page.screenshot({
		path: testInfo.outputPath("telemetry-bridge-idle-retarget.png"),
		fullPage: true,
	});
});

test("Humanizada brinca só com sucesso e Técnica preserva o evento factual", async ({ page }) => {
	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: [fixtureJob("running")],
		jobEvents: [
			{
				seq: 40,
				code: "QWEN_WINDOW_TRANSCRIBED",
				at: "2026-09-27T17:00:00Z",
				level: "info",
				attempt: 1,
				data: {
					track: 1,
					total_tracks: 2,
					speaker: "Faysk",
					window: 205,
					start_seconds: 100,
					end_seconds: 130,
				},
			},
			{
				seq: 41,
				code: "QWEN_ALIGNMENT_WINDOW_FAILED",
				at: "2026-09-27T17:00:01Z",
				level: "error",
				attempt: 1,
				data: {
					track: 1,
					window: 206,
					failure_class: "QWEN_ALIGNMENT_TIMESTAMP_OWNED_OVERFLOW",
				},
			},
		],
		system: {
			gpus: [
				{
					index: 0,
					name: "Synthetic GPU",
					utilizationPercent: 82,
					memoryUsedBytes: 5 * 1024 ** 3,
					memoryTotalBytes: 8 * 1024 ** 3,
				},
			],
		},
	});

	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();

	const overview = page.getByRole("tabpanel", { name: "Visão geral" });
	await expect(
		overview.getByText("Falha de alinhamento Qwen · faixa 1 · janela 206.", {
			exact: true,
		}),
	).toBeVisible();

	await page.getByRole("tab", { name: "Diagnóstico" }).click();
	const log = page.getByRole("log");
	await expect(
		page.getByRole("button", { name: "Humanizada", exact: true }),
	).toHaveAttribute("aria-pressed", "true");
	await expect(log).not.toContainText(
		"Qwen concluiu uma janela de áudio da faixa 1 · janela 205.",
	);
	await expect(log).toContainText(
		"Falha de alinhamento Qwen · faixa 1 · janela 206.",
	);

	await page.getByRole("button", { name: "Técnica", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Técnica", exact: true }),
	).toHaveAttribute("aria-pressed", "true");
	await expect(log).toContainText(
		"Qwen concluiu uma janela de áudio da faixa 1 · janela 205.",
	);
	await expect(log).toContainText(
		"Falha de alinhamento Qwen · faixa 1 · janela 206.",
	);
});

test("Overview não reaproveita atividade rotineira de tentativa anterior", async ({ page }) => {
	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: [fixtureJob("running", { attempt: 2 })],
		jobEvents: [
			{
				seq: 40,
				code: "QWEN_WINDOW_TRANSCRIBED",
				at: "2026-09-27T17:00:00Z",
				level: "info",
				attempt: 1,
				data: { track: 1, speaker: "Faysk", window: 205 },
			},
			{
				seq: 41,
				code: "RUNNING",
				at: "2026-09-27T17:00:01Z",
				level: "info",
				attempt: 2,
				data: { attempt: 2 },
			},
		],
	});

	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await expect(page.getByText("Tentativa 2", { exact: false })).toBeVisible();
	await expect(
		page.getByText("Qwen concluiu uma janela de áudio da faixa 1 · janela 205.", {
			exact: true,
		}),
	).toHaveCount(0);
});

test("falha recuperável cria nova tentativa somente após confirmação", async ({ page }) => {
	const state = await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: [failedJob()],
		jobEvents: [
			{
				seq: 91,
				code: "QWEN_ALIGNMENT_WINDOW_FAILED",
				at: "2026-09-25T12:00:00Z",
				level: "error",
				data: {
					stage: "alignment",
					track: 1,
					window: 89,
					failure_class: "QWEN_ALIGNMENT_TIMESTAMP_OWNED_OVERFLOW",
					runtime_version: "1.0.11",
					worker_sha256: "a".repeat(64),
				},
			},
		],
	});

	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "Fila" }).click();
	await page.getByRole("button", { name: "Atenção", exact: true }).click();
	await page.getByRole("button", { name: /Mais ações para/ }).click();
	await page.getByRole("button", { name: "Abrir Diagnóstico", exact: true }).click();
	const queueTab = page.getByRole("tab", { name: "Fila" });
	await expect(queueTab).toHaveAttribute("aria-selected", "true");
	const inspector = page
		.locator("dialog")
		.filter({ hasText: "Diagnóstico do processamento" });
	await expect(inspector).toBeVisible();
	await expect(
		inspector.getByRole("heading", { name: /Diagnóstico ·/ }),
	).toBeVisible();
	await expect(
		inspector.getByRole("heading", { name: "Histórico de eventos" }),
	).toBeVisible();
	await expect(inspector.getByText("1 mais recente", { exact: true })).toBeVisible();
	await expect(inspector.getByRole("log")).toContainText(
		"Falha de alinhamento Qwen · faixa 1 · janela 89.",
	);
	await expect(inspector.getByRole("log")).toContainText(
		"Uma palavra extrapolou a janela ainda dentro da região que esta janela precisa proteger.",
	);
	await expect(inspector.getByRole("log")).toContainText(
		"Identidade da execução: runtime 1.0.11 · worker SHA-256",
	);
	await inspector.getByRole("button", { name: "Repetir trabalho" }).click();
	const retryDialog = page
		.getByRole("dialog")
		.filter({ hasText: "checkpoints compatíveis serão reutilizados quando disponíveis" });
	await expect(retryDialog).toBeVisible();
	await retryDialog.getByRole("button", { name: "Confirmar", exact: true }).click();

	await expect
		.poll(() => state.job?.attempt)
		.toBe(2);
	expect(state.job?.status).toBe("queued");
	await inspector.getByRole("button", { name: "Fechar" }).click();
	await expect(inspector).not.toBeVisible();
	await expect(queueTab).toHaveAttribute("aria-selected", "true");
	await expect(
		page
			.getByRole("tabpanel", { name: "Fila" })
			.getByRole("button", { name: "Ativos", exact: true }),
	).toHaveAttribute("aria-pressed", "true");
	await expect(
		page
			.getByRole("tabpanel", { name: "Fila" })
			.locator('td[data-label="Estado"]')
			.getByText("Na fila", { exact: true }),
	).toBeVisible();
});

test("fila pausada continua distinta de falha e pode ser retomada", async ({ page }) => {
	const state = await installCompanionFixture(page, {
		profileReady: true,
		lifecycle: "paused",
		advanceJobs: false,
	});
	await page.goto("/");
	await expect(page.getByText("Fila pausada", { exact: true })).toBeVisible();

	await page.getByRole("button", { name: "Retomar novas execuções" }).click();
	await expect(page.getByRole("dialog")).toContainText("iniciar os trabalhos");
	await page.getByRole("button", { name: "Confirmar", exact: true }).click();

	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	expect(
		state.requests.some(
			(request) =>
				request.path === "/lifecycle" && request.method === "POST",
		),
	).toBe(true);
});

test("Overview labels track-count progress with its factual denominator", async ({
	page,
}) => {
	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: [
			fixtureJob("running", {
				progress: { completed: 1, total: 2, unit: "tracks" },
			}),
		],
	});
	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();

	const progress = page.getByRole("progressbar", {
		name: "Progresso por tracks do trabalho craig-job-1: 1 de 2 tracks",
	});
	await expect(progress).toHaveAttribute("value", "1");
	await expect(progress).toHaveAttribute("max", "2");
	await expect(progress.locator("xpath=..")).toHaveAttribute(
		"data-progress-sample-ms",
		"1500",
	);
	await expect(progress).toHaveAttribute("aria-valuetext", "1 de 2 tracks");
	await expect(
		page.getByText("Progresso por tracks · 50%", { exact: true }),
	).toBeVisible();
	await expect(page.getByText("1 de 2 tracks", { exact: true })).toBeVisible();
	await expect(
		page.getByRole("progressbar", { name: /Progresso do trabalho/ }),
	).toHaveCount(0);
});

test("Overview does not borrow track context from a previous retry attempt", async ({
	page,
}) => {
	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: [
			fixtureJob("running", {
				attempt: 2,
				progress: { completed: 0, total: 4, unit: "tracks" },
			}),
		],
		jobEvents: [
			{
				seq: 8,
				code: "RUNNING",
				at: "2026-09-20T18:10:00Z",
				level: "info",
				attempt: 2,
				data: { attempt: 2 },
			},
			{
				seq: 7,
				code: "QWEN_WINDOW_TRANSCRIBED",
				at: "2026-09-20T18:09:59Z",
				level: "info",
				attempt: 1,
				data: {
					track: 3,
					total_tracks: 4,
					speaker: "Alice",
					window: 317,
				},
			},
		],
	});
	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();

	await expect(page.getByText(/Tentativa 2/)).toBeVisible();
	await expect(page.getByText("Arquivo 3 de 4", { exact: true })).toHaveCount(0);
	await expect(page.getByText("Voz: Alice", { exact: true })).toHaveCount(0);
	await expect(page.getByText("Janela 317", { exact: true })).toHaveCount(0);
});

test("Overview keeps factual zero progress and does not infer worker liveness", async ({
	page,
}, testInfo) => {
	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: [
			fixtureJob("running", {
				progress: { completed: 0, total: 4, unit: "tracks" },
			}),
		],
	});
	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();

	const progress = page.getByRole("progressbar");
	await expect(progress).toHaveAttribute("value", "0");
	await expect(progress).toHaveAttribute("max", "4");
	await expect(page.getByText("0 de 4 tracks", { exact: true })).toBeVisible();
	await expect(page.getByText("Perfil qwen-quality", { exact: true })).toBeVisible();
	await expect(page.getByText(/Etapa há .* · atualizado às/)).toBeVisible();
	await expect(page.getByText(/Worker ativo/)).toHaveCount(0);
	await expect(
		page.getByLabel("Métricas do último resultado concluído"),
	).toHaveCount(0);
	await page.screenshot({
		path: testInfo.outputPath("overview-running.png"),
		fullPage: true,
	});
});

test("Overview hides prior run facts during execution and shows them after completion", async ({
	page,
}, testInfo) => {
	const fixture = await installCompanionFixture(page, {
		profileReady: true,
		reviewEnabled: true,
		advanceJobs: false,
		initialJobs: [fixtureJob("running")],
	});
	await page.route(`${LOCAL_API}/sources`, (route) =>
		route.fulfill({
			json: {
				schema_version: "tda_craig_sources_v1",
				sources: [
					{
						source_id: CRAIG_SOURCE_ID,
						source_sha256: "a".repeat(64),
						recording_id: null,
						track_count: 2,
					},
				],
			},
		}),
	);
	await page.route(`${LOCAL_API}/sources/${CRAIG_SOURCE_ID}/runs`, (route) =>
		route.fulfill({
			json: {
				schema_version: "tda_transcription_runs_v1",
				source_id: CRAIG_SOURCE_ID,
				runs: [
					{
						run_id: "run-completed-1",
						status: "completed",
						source_id: CRAIG_SOURCE_ID,
						profile_id: "whisper-detailed",
						engine: "faster-whisper",
						model: "large-v3",
						model_revision: "rev",
						device: "cuda",
						completed_at: "2026-09-21T00:00:00.000Z",
						transcript_sha256: "b".repeat(64),
						transcript_size_bytes: 900,
						stats: {
							processing_seconds: 12,
							session_duration_seconds: 60,
							duration_semantics: "session_extent_v1",
							rtf: 0.2,
							word_count: 2,
							segment_count: 1,
							track_count: 1,
							turn_count: 1,
							warning_count: 0,
						},
						publication_target: {
							schema_version: "tda_publication_target_v1",
							campaign_slug: "yuhara-main",
							source_session_id: "sessao-42",
							job_id: "job-completed-1",
							attempt: 1,
							source_id: CRAIG_SOURCE_ID,
							run_id: "run-completed-1",
							transcript_sha256: "b".repeat(64),
						},
						execution_lineage: {
							schema_version: "tda_execution_lineage_v1",
							device: "cuda",
							gpu: {
								model: "Synthetic GPU",
								vram_total_bytes: 8589934592,
							},
						},
					},
				],
			},
		}),
	);

	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	const metrics = page.getByLabel("Métricas do último resultado concluído");
	await expect(metrics).toHaveCount(0);
	fixture.setJob(fixtureJob("succeeded"));
	await page.getByRole("button", { name: "Atualizar estado" }).click();
	await expect(metrics).toBeVisible();
	await expect(metrics).toContainText("whisper-detailed");
	await expect(metrics).toContainText("12s");
	await expect(metrics).toContainText("1m 00s");
	await expect(metrics).toContainText("0.200");
	await expect(metrics).toContainText("5.00×");
	await expect(metrics).toContainText("Synthetic GPU");
	await expect(metrics).toContainText("2");
	const dimensions = await page.evaluate(() => ({
		scrollWidth: document.documentElement.scrollWidth,
		clientWidth: document.documentElement.clientWidth,
	}));
	expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
	await page.screenshot({
		path: testInfo.outputPath("overview-completed-run.png"),
		fullPage: true,
	});
});

test("Overview omits percent when the progress denominator is absent", async ({
	page,
}) => {
	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: [fixtureJob("running", { progress: null })],
	});
	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();

	await expect(page.getByRole("progressbar")).toHaveCount(0);
	await expect(
		page.getByText("Progresso percentual ainda não disponível.", { exact: true }),
	).toHaveCount(0);
	await expect(
		page
			.getByRole("region", { name: "Etapa atual do processamento" })
			.getByText("Transcrição", { exact: true }),
	).toBeVisible();
});

test("Overview keeps queued-only state compact and identifies waiting work", async ({
	page,
}, testInfo) => {
	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: [fixtureJob("queued")],
	});
	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await expect(page.getByText("Nada processando agora.")).toBeVisible();
	await expect(
		page.getByText("Há trabalhos aguardando a próxima execução."),
	).toBeVisible();
	await page.screenshot({
		path: testInfo.outputPath("overview-queued-only.png"),
		fullPage: true,
	});
});

test("Overview gives truly idle space to the Craig composer when the queue is empty", async ({
	page,
}, testInfo) => {
	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
	});
	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await expect(page.getByText("Nada processando agora.")).not.toBeVisible();
	await expect(page.getByText("A fila local está livre.")).not.toBeVisible();
	await expect(page.locator("[data-craig-composer='true']")).toHaveAttribute(
		"data-layout",
		"default",
	);
	await page.screenshot({
		path: testInfo.outputPath("overview-idle-composer.png"),
		fullPage: true,
	});
});

test("idle Full HD keeps the essential composer and recent result in one viewport", async ({ page }) => {
	await page.setViewportSize({ width: 1920, height: 1080 });
	await installCompanionFixture(page, {
		profileReady: true,
		reviewEnabled: true,
		advanceJobs: false,
	});
	await installCompletedRunCatalog(page);
	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();

	const composer = page.locator("[data-craig-composer='true']");
	const metrics = page.getByLabel("Métricas do último resultado concluído");
	await expect(composer).toBeVisible();
	await expect(metrics).toBeVisible();

	const dropBox = await composer.locator("[data-craig-drop-target='true']").boundingBox();
	expect(dropBox).not.toBeNull();
	expect(dropBox?.height ?? 999).toBeLessThanOrEqual(64);

	await expect(metrics.getByText("Processamento", { exact: true })).toBeVisible();
	await expect(metrics.getByText("Warnings", { exact: true })).toBeVisible();
	await expect(metrics.getByText("Segmentos", { exact: true })).not.toBeVisible();

	const initialViewport = await page.evaluate(() => ({
		scrollHeight: document.documentElement.scrollHeight,
		clientHeight: document.documentElement.clientHeight,
	}));
	expect(initialViewport.scrollHeight).toBeLessThanOrEqual(initialViewport.clientHeight + 1);

	const resultDetails = metrics.getByText("Ver detalhes do resultado", { exact: true });
	await resultDetails.focus();
	await page.keyboard.press("Enter");
	await expect(metrics.getByText("Segmentos", { exact: true })).toBeVisible();
	await page.keyboard.press("Enter");
	await expect(metrics.getByText("Segmentos", { exact: true })).not.toBeVisible();

	const advanced = composer.locator("summary").filter({ hasText: "Opções avançadas" });
	await advanced.focus();
	await expect(advanced).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(composer.getByLabel("Contexto opcional")).toBeVisible();
	const advancedDetails = advanced.locator("..");
	const [composerBox, advancedBox, contextBox, glossaryBox] = await Promise.all([
		composer.boundingBox(),
		advancedDetails.boundingBox(),
		composer.getByLabel("Contexto opcional").boundingBox(),
		composer.getByLabel("Glossário opcional").boundingBox(),
	]);
	expect(composerBox).not.toBeNull();
	expect(advancedBox).not.toBeNull();
	if (composerBox && advancedBox)
		expect(advancedBox.width).toBeGreaterThan(composerBox.width * 0.85);
	expect(contextBox).not.toBeNull();
	expect(glossaryBox).not.toBeNull();
	if (contextBox && glossaryBox)
		expect(Math.abs(contextBox.y - glossaryBox.y)).toBeLessThanOrEqual(2);
	await advanced.focus();
	await page.keyboard.press("Enter");
	await expect(composer.getByLabel("Contexto opcional")).not.toBeVisible();

	const restoredViewport = await page.evaluate(() => ({
		scrollHeight: document.documentElement.scrollHeight,
		clientHeight: document.documentElement.clientHeight,
	}));
	expect(restoredViewport.scrollHeight).toBeLessThanOrEqual(restoredViewport.clientHeight + 1);
});




test("unbound local runs stay in recovery and do not become campaign metrics", async ({ page }) => {
	await installCompanionFixture(page, {
		profileReady: true,
		reviewEnabled: true,
		serviceVersion: "0.3.16",
		advanceJobs: false,
	});
	await installCompletedRunCatalog(page, { publicationTarget: null });
	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();

	await expect(page.getByLabel("Métricas do último resultado concluído")).toHaveCount(0);

	await page.getByRole("tab", { name: "Resultados" }).click();
	const recovery = page.locator('[data-unbound-local-runs="true"]');
	await expect(recovery).toBeVisible();
	await expect(
		recovery.getByRole("heading", {
			name: "Resultados locais sem campanha confirmada",
		}),
	).toBeVisible();
	await expect(recovery).toContainText(
		"não contam como resultados de Crônicas da Mesa",
	);
	await expect(recovery.getByRole("button", { name: "Revisar resultado" })).toBeVisible();
});

test("run targeted to another campaign is excluded from the active campaign results", async ({ page }) => {
	await installCompanionFixture(page, {
		profileReady: true,
		reviewEnabled: true,
		serviceVersion: "0.3.16",
		advanceJobs: false,
	});
	await installCompletedRunCatalog(page, {
		publicationTarget: "antes-que-seja-tarde",
	});
	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await expect(page.getByLabel("Métricas do último resultado concluído")).toHaveCount(0);

	await page.getByRole("tab", { name: "Resultados" }).click();
	await expect(page.locator('[data-unbound-local-runs="true"]')).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Revisar resultado" })).toHaveCount(0);
});

test("Stable 0.3.15 hides completed-run deletion while Results remains usable", async ({ page }) => {
	await installCompanionFixture(page, {
		profileReady: true,
		reviewEnabled: true,
		serviceVersion: "0.3.15",
		advanceJobs: false,
	});
	await installCompletedRunCatalog(page);
	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "Resultados" }).click();
	await expect(page.getByRole("button", { name: "Revisar resultado" })).toBeVisible();
	await expect(page.getByLabel("Mais ações do resultado")).toHaveCount(0);
	await expect(page.getByRole("button", { name: /Excluir resultado local/ })).toHaveCount(0);
});
test("Results keeps selected-run detail in document flow on Full HD", async ({ page }, testInfo) => {
	await page.setViewportSize({ width: 1920, height: 1080 });
	await installCompanionFixture(page, {
		profileReady: true,
		reviewEnabled: true,
		serviceVersion: "0.3.16",
		advanceJobs: false,
	});
	await installCompletedRunCatalog(page);
	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "Resultados" }).click();
	const runCard = page.locator("article").filter({ hasText: "Resultado local" }).first();
	const reviewAction = page.getByRole("button", { name: "Revisar resultado" });
	const resultsSearch = page.locator("[data-results-search='true']");
	const resultsMaster = page.locator("[data-results-master='true']");
	const resultsDetail = page.locator("[data-results-detail='true']");
	const resultsFilterStart = page.locator("[data-results-filter-start='true']");
	const resultsCount = page.getByText("1 resultado", { exact: true });
	await expect(reviewAction).toBeVisible();
	await expect(runCard.getByText("Integridade e IDs", { exact: true })).toBeVisible();
	await expect(resultsSearch).toBeVisible();
	await expect(resultsMaster).toBeVisible();
	await expect(resultsDetail).toBeVisible();
	await expect(resultsFilterStart).toBeVisible();
	await expect(resultsCount).toBeVisible();

	const alignedGeometry = await page.evaluate(() => {
		const search = document.querySelector("[data-results-search='true']");
		const master = document.querySelector("[data-results-master='true']");
		const detail = document.querySelector("[data-results-detail='true']");
		const filter = document.querySelector("[data-results-filter-start='true']");
		if (!(search instanceof HTMLElement) || !(master instanceof HTMLElement) || !(detail instanceof HTMLElement) || !(filter instanceof HTMLElement)) {
			throw new Error("Results alignment targets are missing");
		}
		const searchBox = search.getBoundingClientRect();
		const masterBox = master.getBoundingClientRect();
		const detailBox = detail.getBoundingClientRect();
		const filterBox = filter.getBoundingClientRect();
		return {
			searchRight: searchBox.right,
			masterRight: masterBox.right,
			detailLeft: detailBox.left,
			filterLeft: filterBox.left,
		};
	});
	expect(Math.abs(alignedGeometry.searchRight - alignedGeometry.masterRight)).toBeLessThanOrEqual(2);
	expect(Math.abs(alignedGeometry.detailLeft - alignedGeometry.filterLeft)).toBeLessThanOrEqual(2);
	const [countBox, detailBox] = await Promise.all([resultsCount.boundingBox(), resultsDetail.boundingBox()]);
	expect(countBox).not.toBeNull();
	expect(detailBox).not.toBeNull();
	if (countBox && detailBox) expect(countBox.x).toBeLessThan(detailBox.x);

	const [actionBox, primaryFactsBox] = await Promise.all([
		reviewAction.boundingBox(),
		runCard.locator("[data-run-primary-facts='true']").boundingBox(),
	]);
	expect(actionBox).not.toBeNull();
	expect(primaryFactsBox).not.toBeNull();
	if (actionBox && primaryFactsBox) {
		expect(actionBox.y).toBeLessThan(primaryFactsBox.y);
	}
	await page.screenshot({
		path: testInfo.outputPath("results-selected-run-density.png"),
		fullPage: false,
	});
	const detail = await runCard.evaluate((card) => {
		const owner = card.parentElement;
		if (!owner) return null;
		const style = getComputedStyle(owner);
		return { overflowY: style.overflowY, scrollHeight: owner.scrollHeight, clientHeight: owner.clientHeight };
	});
	expect(detail).not.toBeNull();
	expect(["auto", "scroll"]).not.toContain(detail?.overflowY);
	expect(detail?.scrollHeight).toBe(detail?.clientHeight);

	const comparisonDisclosure = page.getByText("Comparar runs", { exact: true }).first();
	const comparisonReason = page.getByText(
		"Somente resultados da mesma fonte podem ser comparados.",
		{ exact: true },
	);
	await expect(comparisonDisclosure).toBeVisible();
	await expect(comparisonReason).toBeHidden();
	await comparisonDisclosure.focus();
	await page.keyboard.press("Enter");
	await expect(comparisonReason).toBeVisible();
	await page.keyboard.press("Enter");
	await expect(comparisonReason).toBeHidden();

	for (const disclosureName of [
		"Execução e métricas",
		"Medição",
		"Integridade e IDs",
	] as const) {
		const disclosure = runCard.getByText(disclosureName, { exact: true });
		await disclosure.focus();
		await page.keyboard.press("Enter");
	}

	for (const viewport of [
		{ width: 3840, height: 2160 },
		{ width: 2560, height: 1440 },
		{ width: 2048, height: 1279 },
		{ width: 1440, height: 900 },
		{ width: 1366, height: 768 },
		{ width: 960, height: 540 },
		{ width: 390, height: 844 },
	]) {
		await page.setViewportSize(viewport);
		const horizontal = await page.evaluate(() => ({
			scrollWidth: document.documentElement.scrollWidth,
			clientWidth: document.documentElement.clientWidth,
		}));
		expect(horizontal.scrollWidth).toBeLessThanOrEqual(horizontal.clientWidth + 1);
		if (viewport.width > 980) {
			const geometry = await page.evaluate(() => {
				const search = document.querySelector("[data-results-search='true']");
				const master = document.querySelector("[data-results-master='true']");
				const detail = document.querySelector("[data-results-detail='true']");
				const filter = document.querySelector("[data-results-filter-start='true']");
				if (!(search instanceof HTMLElement) || !(master instanceof HTMLElement) || !(detail instanceof HTMLElement) || !(filter instanceof HTMLElement)) {
					throw new Error("Responsive Results alignment targets are missing");
				}
				return {
					searchRight: search.getBoundingClientRect().right,
					masterRight: master.getBoundingClientRect().right,
					detailLeft: detail.getBoundingClientRect().left,
					filterLeft: filter.getBoundingClientRect().left,
				};
			});
			expect(Math.abs(geometry.searchRight - geometry.masterRight)).toBeLessThanOrEqual(2);
			expect(Math.abs(geometry.detailLeft - geometry.filterLeft)).toBeLessThanOrEqual(2);
		} else if (viewport.width <= 760) {
			const [masterBox, detailBox] = await Promise.all([resultsMaster.boundingBox(), resultsDetail.boundingBox()]);
			expect(masterBox).not.toBeNull();
			expect(detailBox).not.toBeNull();
			if (masterBox && detailBox) expect(detailBox.y).toBeGreaterThan(masterBox.y);
		}
	}
});

test("Results keeps empty Session Assembly and sync context compact", async ({ page }) => {
	await page.setViewportSize({ width: 1920, height: 1080 });
	await page.addInitScript(() => {
		window.localStorage.setItem(
			"tda.processing.session-composer.last-session.v2:yuhara-main",
			"sessao-42",
		);
	});
	await installCompanionFixture(page, {
		profileReady: true,
		reviewEnabled: true,
		serviceVersion: "0.3.16",
		advanceJobs: false,
		additionalCapabilities: [
			"transcription.session-assembly",
			"transcription.session-assembly.review",
		],
	});
	await installCompletedRunCatalog(page);
	await page.route(
		`${LOCAL_API}/session-workspaces/yuhara-main/sessao-42/assemblies`,
		(route) =>
			fulfillJson(route, {
				schema_version: "tda_session_assemblies_v1",
				campaign_id: "yuhara-main",
				session_id: "sessao-42",
				assemblies: [],
			}),
	);
	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "Resultados" }).click();

	const assembly = page.locator("[data-results-assembly='true']");
	await expect(assembly).toBeVisible();
	await expect(assembly).toHaveAttribute("data-empty", "true");
	await expect(
		assembly.getByText("Nenhuma assembly concluída para a sessão ativa.", {
			exact: true,
		}),
	).toBeVisible();

	const assemblyGeometry = await assembly.evaluate((element) => {
		const style = getComputedStyle(element);
		return {
			height: element.getBoundingClientRect().height,
			borderTopWidth: style.borderTopWidth,
			borderRadius: style.borderRadius,
			backgroundColor: style.backgroundColor,
		};
	});
	expect(assemblyGeometry.height).toBeLessThanOrEqual(72);
	expect(assemblyGeometry.borderTopWidth).toBe("0px");
	expect(assemblyGeometry.borderRadius).toBe("0px");
	expect(assemblyGeometry.backgroundColor).toBe("rgba(0, 0, 0, 0)");

	const sync = page.locator("[data-results-sync='true']");
	await expect(sync).toBeVisible();
	await expect(sync).toHaveAttribute("data-state", "unconfigured");
	await expect(sync.getByText("Sincronização não configurada.", { exact: true })).toBeVisible();
	const syncStyle = await sync.evaluate((element) => {
		const style = getComputedStyle(element);
		return {
			borderRadius: style.borderRadius,
			backgroundColor: style.backgroundColor,
			borderTopWidth: style.borderTopWidth,
		};
	});
	expect(syncStyle.borderRadius).toBe("0px");
	expect(syncStyle.backgroundColor).toBe("rgba(0, 0, 0, 0)");
	expect(syncStyle.borderTopWidth).toBe("1px");
});

test("Results keeps a 20-run master rail scrollable without page overflow", async ({ page }) => {
	await page.setViewportSize({ width: 1920, height: 1080 });
	await installCompanionFixture(page, {
		profileReady: true,
		reviewEnabled: true,
		serviceVersion: "0.3.16",
		advanceJobs: false,
	});
	await installCompletedRunCatalog(page, 20);
	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "Resultados" }).click();

	const master = page.locator("[data-results-master='true']");
	await expect(page.getByText("20 resultados", { exact: true })).toBeVisible();
	await expect(master.locator("button")).toHaveCount(20);
	const scrollState = await master.evaluate((element) => ({
		overflowY: getComputedStyle(element).overflowY,
		scrollHeight: element.scrollHeight,
		clientHeight: element.clientHeight,
		pageScrollWidth: document.documentElement.scrollWidth,
		pageClientWidth: document.documentElement.clientWidth,
	}));
	expect(["auto", "scroll"]).toContain(scrollState.overflowY);
	expect(scrollState.scrollHeight).toBeGreaterThan(scrollState.clientHeight);
	expect(scrollState.pageScrollWidth).toBeLessThanOrEqual(scrollState.pageClientWidth + 1);
});

test("Results keeps a completed Session Assembly legible and actionable", async ({ page }) => {
	await page.setViewportSize({ width: 1920, height: 1080 });
	await page.addInitScript(() => {
		window.localStorage.setItem(
			"tda.processing.session-composer.last-session.v2:yuhara-main",
			"sessao-42",
		);
	});
	await installCompanionFixture(page, {
		profileReady: true,
		reviewEnabled: true,
		serviceVersion: "0.3.16",
		advanceJobs: false,
		additionalCapabilities: [
			"transcription.session-assembly",
			"transcription.session-assembly.review",
		],
	});
	await installCompletedRunCatalog(page);
	await page.route(
		`${LOCAL_API}/session-workspaces/yuhara-main/sessao-42/assemblies`,
		(route) =>
			fulfillJson(route, {
				schema_version: "tda_session_assemblies_v1",
				campaign_id: "yuhara-main",
				session_id: "sessao-42",
				assemblies: [
					{
						assembly_id: "c".repeat(64),
						transcript_sha256: "d".repeat(64),
						inputs_sha256: "c".repeat(64),
						segment_count: 10,
						part_count: 2,
						participant_approval_blocked: false,
						created_at: "2026-09-29T18:00:00.000Z",
					},
				],
			}),
	);
	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "Resultados" }).click();

	const assembly = page.locator("[data-results-assembly='true']");
	await expect(assembly).toHaveAttribute("data-empty", "false");
	await expect(assembly.getByText("2 gravações · 10 segmentos", { exact: true })).toBeVisible();
	await expect(assembly.getByRole("button", { name: "Abrir revisão" })).toBeVisible();
	const horizontal = await page.evaluate(() => ({
		scrollWidth: document.documentElement.scrollWidth,
		clientWidth: document.documentElement.clientWidth,
	}));
	expect(horizontal.scrollWidth).toBeLessThanOrEqual(horizontal.clientWidth + 1);
});

test("Results keeps Session Assembly failure explicit without hiding the workspace", async ({ page }) => {
	await page.setViewportSize({ width: 1920, height: 1080 });
	await page.addInitScript(() => {
		window.localStorage.setItem(
			"tda.processing.session-composer.last-session.v2:yuhara-main",
			"sessao-42",
		);
	});
	await installCompanionFixture(page, {
		profileReady: true,
		reviewEnabled: true,
		serviceVersion: "0.3.16",
		advanceJobs: false,
		additionalCapabilities: [
			"transcription.session-assembly",
			"transcription.session-assembly.review",
		],
	});
	await installCompletedRunCatalog(page);
	await page.route(
		`${LOCAL_API}/session-workspaces/yuhara-main/sessao-42/assemblies`,
		(route) => route.fulfill({ status: 503, body: "unavailable" }),
	);
	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "Resultados" }).click();

	await expect(page.locator("[data-results-assembly='true']")).toBeVisible();
	await expect(
		page.getByRole("alert").filter({
			hasText: "Não foi possível atualizar as assemblies desta sessão.",
		}),
	).toBeVisible();
	await expect(page.getByRole("button", { name: "Revisar resultado" })).toBeVisible();
});

test("Results distinguishes configured publication while keeping healthy sync contextual", async ({ page }) => {
	await page.setViewportSize({ width: 1920, height: 1080 });
	await installCompanionFixture(page, {
		profileReady: true,
		reviewEnabled: true,
		serviceVersion: "0.3.16",
		advanceJobs: false,
	});
	await installCompletedRunCatalog(page);
	await page.goto("/?publication");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "Resultados" }).click();

	const sync = page.locator("[data-results-sync='true']");
	await expect(sync).toHaveAttribute("data-state", "ready");
	await expect(sync.getByText("Handoff privado para o Edit disponível.", { exact: true })).toBeVisible();
	const style = await sync.evaluate((element) => {
		const computed = getComputedStyle(element);
		return {
			borderRadius: computed.borderRadius,
			backgroundColor: computed.backgroundColor,
			borderTopWidth: computed.borderTopWidth,
		};
	});
	expect(style.borderRadius).toBe("0px");
	expect(style.backgroundColor).toBe("rgba(0, 0, 0, 0)");
	expect(style.borderTopWidth).toBe("1px");
});

test("Companion 0.3.16 exposes completed-run deletion without changing job-delete compatibility", async ({ page }) => {
	await installCompanionFixture(page, {
		profileReady: true,
		reviewEnabled: true,
		serviceVersion: "0.3.16",
		advanceJobs: false,
	});
	await installCompletedRunCatalog(page);
	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "Resultados" }).click();
	await expect(page.getByRole("button", { name: "Revisar resultado" })).toBeVisible();
	const moreActions = page.getByLabel("Mais ações do resultado");
	await expect(moreActions).toBeVisible();
	await moreActions.click();
	await expect(page.getByRole("button", { name: /Excluir resultado local/ })).toBeVisible();
});


test("Queue Open result navigates to the exact immutable run without opening review", async ({
	page,
}) => {
	await installCompanionFixture(page, {
		profileReady: true,
		reviewEnabled: true,
		advanceJobs: false,
		initialJobs: [fixtureJob("succeeded")],
	});
	await installCompletedRunCatalog(page, {
		runId: "run-craig-job-1-a1",
		profileId: "qwen-quality",
		engine: "qwen3",
		model: "fixture-qwen",
		transcriptSha256: "b".repeat(64),
	});

	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "Fila" }).click();
	const queue = page.getByRole("tabpanel", { name: "Fila" });
	await queue.getByRole("button", { name: /Concluídos/ }).click();
	const openResult = queue.getByRole("button", { name: "Abrir resultado" });
	await openResult.focus();
	await page.keyboard.press("Enter");

	await expect(page.getByRole("tab", { name: "Resultados" })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	const selectedRun = page.locator(
		"button[data-local-run-key][aria-current='true']",
	);
	await expect(selectedRun).toContainText("qwen-quality");
	await expect(selectedRun).toHaveAttribute(
		"data-local-run-key",
		/run-craig-job-1-a1/,
	);
	await expect(selectedRun).toBeFocused();
	await expect(
		page.getByRole("button", { name: "Revisar resultado" }),
	).toBeVisible();
	await expect(
		page.getByText("Voltar aos resultados", { exact: true }),
	).toHaveCount(0);
});

test("contextual diagnostics delegates Open result to the exact immutable run flow", async ({
	page,
}) => {
	await installCompanionFixture(page, {
		profileReady: true,
		reviewEnabled: true,
		advanceJobs: false,
		initialJobs: [fixtureJob("succeeded")],
	});
	await installCompletedRunCatalog(page, {
		runId: "run-craig-job-1-a1",
		profileId: "qwen-quality",
		engine: "qwen3",
		model: "fixture-qwen",
		transcriptSha256: "b".repeat(64),
	});

	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "Fila" }).click();
	const queue = page.getByRole("tabpanel", { name: "Fila" });
	await queue.getByRole("button", { name: /Concluídos/ }).click();
	await queue.getByRole("button", { name: /Mais ações para/ }).click();
	await page.getByRole("button", { name: "Abrir Diagnóstico", exact: true }).click();

	const inspector = page
		.locator("dialog[data-job-diagnostics='contextual']")
		.filter({ hasText: "Diagnóstico do processamento" });
	await expect(inspector).toBeVisible();
	await expect(page.getByRole("tab", { name: "Fila" })).toHaveAttribute(
		"aria-selected",
		"true",
	);

	await inspector.getByRole("button", { name: "Abrir resultado" }).click();

	await expect(inspector).not.toBeVisible();
	await expect(page.getByRole("tab", { name: "Resultados" })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	const selectedRun = page.locator(
		"button[data-local-run-key][aria-current='true']",
	);
	await expect(selectedRun).toHaveAttribute(
		"data-local-run-key",
		/run-craig-job-1-a1/,
	);
	await expect(selectedRun).toBeFocused();
});

test("contextual diagnostics keeps a result read failure visible without leaving Queue", async ({
	page,
}) => {
	await installCompanionFixture(page, {
		profileReady: true,
		reviewEnabled: true,
		advanceJobs: false,
		initialJobs: [fixtureJob("succeeded")],
	});
	await page.route(`${LOCAL_API}/jobs/craig-job-1/result`, (route) =>
		fulfillJson(
			route,
			{ error: { code: "RESULT_NOT_FOUND", recoverable: true } },
			404,
		),
	);

	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "Fila" }).click();
	const queue = page.getByRole("tabpanel", { name: "Fila" });
	await queue.getByRole("button", { name: /Concluídos/ }).click();
	await queue.getByRole("button", { name: /Mais ações para/ }).click();
	await page.getByRole("button", { name: "Abrir Diagnóstico", exact: true }).click();

	const inspector = page.locator("dialog[data-job-diagnostics='contextual']");
	await inspector.getByRole("button", { name: "Abrir resultado" }).click();

	await expect(inspector).toBeVisible();
	await expect(page.getByRole("tab", { name: "Fila" })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(
		inspector.getByRole("alert").filter({
			hasText:
				"Não foi possível abrir este resultado local. O trabalho foi preservado; tente novamente ou consulte o diagnóstico.",
		}),
	).toBeVisible();
});

test("Queue Open result walks the paginated catalog to the authoritative identity", async ({
	page,
}) => {
	await installCompanionFixture(page, {
		profileReady: true,
		reviewEnabled: true,
		additionalCapabilities: ["transcription.runs.catalog"],
		advanceJobs: false,
		initialJobs: [fixtureJob("succeeded")],
	});

	const requestedCursors: string[] = [];
	const catalogRun = (
		sourceId: string,
		runId: string,
		sha: string,
		profileId = "qwen-quality",
	) => ({
		run_id: runId,
		status: "completed",
		source_id: sourceId,
		profile_id: profileId,
		engine: "qwen3",
		model: "fixture-qwen",
		model_revision: "rev",
		device: "cuda",
		completed_at: "2026-09-29T14:00:00.000Z",
		transcript_sha256: sha,
		transcript_size_bytes: 900,
		stats: {
			processing_seconds: 12,
			session_duration_seconds: 60,
			duration_semantics: "session_extent_v1",
			rtf: 0.2,
			word_count: 2,
			segment_count: 1,
			track_count: 1,
			turn_count: 1,
			warning_count: 0,
		},
		execution_lineage: {
			schema_version: "tda_execution_lineage_v1",
			device: "cuda",
			gpu: { model: "Synthetic GPU", vram_total_bytes: 8589934592 },
		},
	});

	await page.route(`${LOCAL_API}/runs*`, (route) => {
		const cursor =
			new URL(route.request().url()).searchParams.get("cursor") ?? "";
		requestedCursors.push(cursor);
		if (cursor === "page-2") {
			return fulfillJson(route, {
				schema_version: "tda_local_run_catalog_v1",
				runs: [
					catalogRun(
						CRAIG_SOURCE_ID,
						"run-craig-job-1-a1",
						"b".repeat(64),
					),
				],
				has_more: false,
				next_cursor: null,
			});
		}
		return fulfillJson(route, {
			schema_version: "tda_local_run_catalog_v1",
			runs: [
				catalogRun(
					`craig-${"c".repeat(64)}`,
					"run-other-source",
					"d".repeat(64),
				),
				catalogRun(
					CRAIG_SOURCE_ID,
					"run-same-source-other-attempt",
					"e".repeat(64),
				),
			],
			has_more: true,
			next_cursor: "page-2",
		});
	});

	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "Fila" }).click();
	const queue = page.getByRole("tabpanel", { name: "Fila" });
	await queue.getByRole("button", { name: /Concluídos/ }).click();
	await queue.getByRole("button", { name: "Abrir resultado" }).click();

	await expect(page.getByRole("tab", { name: "Resultados" })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	const selectedRun = page.locator(
		"button[data-local-run-key][aria-current='true']",
	);
	await expect(selectedRun).toHaveAttribute(
		"data-local-run-key",
		/run-craig-job-1-a1/,
	);
	await expect(selectedRun).toBeFocused();
	expect(requestedCursors).toContain("page-2");
});

test("Queue Open result reports read failure without fake navigation", async ({
	page,
}) => {
	await installCompanionFixture(page, {
		profileReady: true,
		reviewEnabled: true,
		advanceJobs: false,
		initialJobs: [fixtureJob("succeeded")],
	});
	await page.route(`${LOCAL_API}/jobs/craig-job-1/result`, (route) =>
		fulfillJson(
			route,
			{ error: { code: "RESULT_NOT_FOUND", recoverable: true } },
			404,
		),
	);

	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "Fila" }).click();
	const queue = page.getByRole("tabpanel", { name: "Fila" });
	await queue.getByRole("button", { name: /Concluídos/ }).click();
	await queue.getByRole("button", { name: "Abrir resultado" }).click();

	await expect(page.getByRole("tab", { name: "Fila" })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(
		page.getByText(
			"Não foi possível abrir este resultado local. O trabalho foi preservado; tente novamente ou consulte o diagnóstico.",
			{ exact: true },
		),
	).toBeVisible();
});

test("Queue Open result surfaces a valid-but-missing run instead of silently selecting another", async ({
	page,
}) => {
	await installCompanionFixture(page, {
		profileReady: true,
		reviewEnabled: true,
		advanceJobs: false,
		initialJobs: [fixtureJob("succeeded")],
	});
	await installCompletedRunCatalog(page, {
		runId: "run-same-source-but-not-target",
		profileId: "qwen-quality",
		engine: "qwen3",
		model: "fixture-qwen",
		transcriptSha256: "c".repeat(64),
	});

	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "Fila" }).click();
	const queue = page.getByRole("tabpanel", { name: "Fila" });
	await queue.getByRole("button", { name: /Concluídos/ }).click();
	await queue.getByRole("button", { name: "Abrir resultado" }).click();

	await expect(page.getByRole("tab", { name: "Fila" })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(
		page.getByText(
			"O resultado foi validado, mas o run correspondente não pôde ser confirmado na biblioteca local. Atualize os resultados ou consulte o diagnóstico.",
			{ exact: true },
		),
	).toBeVisible();
});

test("Queue Open result rejects a run with matching IDs but mismatched transcript hash", async ({
	page,
}) => {
	await installCompanionFixture(page, {
		profileReady: true,
		reviewEnabled: true,
		advanceJobs: false,
		initialJobs: [fixtureJob("succeeded")],
	});
	await installCompletedRunCatalog(page, {
		runId: "run-craig-job-1-a1",
		profileId: "qwen-quality",
		engine: "qwen3",
		model: "fixture-qwen",
		transcriptSha256: "c".repeat(64),
	});

	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "Fila" }).click();
	const queue = page.getByRole("tabpanel", { name: "Fila" });
	await queue.getByRole("button", { name: /Concluídos/ }).click();
	await queue.getByRole("button", { name: "Abrir resultado" }).click();

	await expect(page.getByRole("tab", { name: "Fila" })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(
		page.getByText(
			"O resultado foi validado, mas o run correspondente não pôde ser confirmado na biblioteca local. Atualize os resultados ou consulte o diagnóstico.",
			{ exact: true },
		),
	).toBeVisible();
});

test("Queue result stays pending and wins over a concurrent refresh", async ({
	page,
}) => {
	await installCompanionFixture(page, {
		profileReady: true,
		reviewEnabled: true,
		additionalCapabilities: ["transcription.runs.catalog"],
		advanceJobs: false,
		initialJobs: [fixtureJob("succeeded")],
		jobReadDelayMs: 250,
	});

	await page.route(`${LOCAL_API}/runs*`, async (route) => {
		const cursor =
			new URL(route.request().url()).searchParams.get("cursor") ?? "";
		const run = {
			run_id: cursor === "page-2" ? "run-craig-job-1-a1" : "run-unrelated",
			status: "completed",
			source_id: CRAIG_SOURCE_ID,
			profile_id: "qwen-quality",
			engine: "qwen3",
			model: "fixture-qwen",
			model_revision: "rev",
			device: "cuda",
			completed_at: "2026-09-29T14:00:00.000Z",
			transcript_sha256: (cursor === "page-2" ? "b" : "c").repeat(64),
			transcript_size_bytes: 900,
			stats: {},
		};
		if (cursor === "page-2")
			await new Promise((resolve) => setTimeout(resolve, 400));
		return fulfillJson(route, {
			schema_version: "tda_local_run_catalog_v1",
			runs: [run],
			has_more: cursor !== "page-2",
			next_cursor: cursor === "page-2" ? null : "page-2",
		});
	});

	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Atualizar estado", exact: true }).click();
	await page.getByRole("tab", { name: "Fila" }).click();
	const queue = page.getByRole("tabpanel", { name: "Fila" });
	await queue.getByRole("button", { name: /Concluídos/ }).click();

	const open = queue.getByRole("button", { name: "Abrir resultado" });
	await open.click();
	await expect(queue.getByRole("button", { name: "Abrindo…" })).toBeVisible();

	await expect(page.getByRole("tab", { name: "Resultados" })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	const selectedRun = page.locator(
		"button[data-local-run-key][aria-current='true']",
	);
	await expect(selectedRun).toHaveAttribute(
		"data-local-run-key",
		/run-craig-job-1-a1/,
	);
	await page.waitForTimeout(350);
	await expect(selectedRun).toHaveAttribute(
		"data-local-run-key",
		/run-craig-job-1-a1/,
	);
});

test("Overview opens running-job diagnostics contextually and exposes cancel without leaving Overview", async ({
	page,
}) => {
	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: [fixtureJob("running")],
	});
	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();

	const overviewTab = page.getByRole("tab", { name: "Visão geral", exact: true });
	await expect(overviewTab).toHaveAttribute("aria-selected", "true");
	const overviewDiagnosticsButton = page
		.getByRole("tabpanel", { name: "Visão geral" })
		.getByRole("button", { name: "Abrir diagnóstico", exact: true });
	await overviewDiagnosticsButton.click();

	const inspector = page.locator("dialog[data-job-diagnostics='contextual']");
	await expect(inspector).toBeVisible();
	await expect(overviewTab).toHaveAttribute("aria-selected", "true");
	await expect(inspector).toHaveAttribute("data-job-id", "craig-job-1");
	await expect(inspector.getByRole("button", { name: "Cancelar" })).toBeVisible();

	await inspector.getByRole("button", { name: "Fechar" }).click();
	await expect(inspector).not.toBeVisible();
	await expect(overviewTab).toHaveAttribute("aria-selected", "true");
	await expect(overviewDiagnosticsButton).toBeFocused();
});

test("Queue per-job diagnostics opens contextually and preserves the Queue view", async ({ page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: {
				writeText: async (value: string) => {
					(window as Window & { __copiedJobDiagnostic?: string }).__copiedJobDiagnostic =
						value;
				},
			},
		});
	});
	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: [failedJob({ attempt: 2 })],
		jobEvents: [
			{
				seq: 90,
				attempt: 1,
				code: "OLD_ATTEMPT_EVENT",
				at: "2026-09-29T13:59:59Z",
				level: "warning",
				data: { stage: "transcription", track: 1 },
			},
			{
				seq: 91,
				attempt: 2,
				code: "QWEN_ALIGNMENT_WINDOW_FAILED",
				at: "2026-09-29T14:00:00Z",
				level: "error",
				data: {
					stage: "alignment",
					track: 1,
					window: 89,
					speaker: "Alice",
					failure_class: "QWEN_ALIGNMENT_TIMESTAMP_OWNED_OVERFLOW",
				},
			},
		],
	});

	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "Fila" }).click();
	const queueTab = page.getByRole("tab", { name: "Fila" });
	const queue = page.getByRole("tabpanel", { name: "Fila" });
	await queue.getByRole("button", { name: "Atenção", exact: true }).click();
	const search = queue.getByLabel("Buscar");
	await search.fill("sessao-42");
	const moreActions = queue.getByRole("button", { name: /Mais ações para/ });
	await moreActions.click();
	await page.getByRole("button", { name: "Abrir Diagnóstico", exact: true }).click();

	await expect(queueTab).toHaveAttribute("aria-selected", "true");
	const inspector = page.locator("dialog").filter({ hasText: "Diagnóstico do processamento" });
	await expect(inspector).toBeVisible();
	await expect(inspector).toContainText("craig-job-1");
	await expect(inspector).toContainText("QWEN_ALIGNMENT_REQUIRED");
	await expect(inspector.getByRole("log")).toContainText("Falha de alinhamento Qwen");

	await inspector.getByRole("button", { name: "Copiar Job ID" }).click();
	await expect(inspector.getByText("Job ID copiado.", { exact: true })).toBeVisible();
	expect(
		await page.evaluate(
			() => (window as Window & { __copiedJobDiagnostic?: string }).__copiedJobDiagnostic,
		),
	).toBe("craig-job-1");

	await inspector.getByRole("button", { name: "Copiar Source ID" }).click();
	await expect(inspector.getByText("Source ID copiado.", { exact: true })).toBeVisible();
	expect(
		await page.evaluate(
			() => (window as Window & { __copiedJobDiagnostic?: string }).__copiedJobDiagnostic,
		),
	).toBe(CRAIG_SOURCE_ID);

	await inspector.getByRole("button", { name: "Copiar diagnóstico" }).click();
	await expect(inspector.getByText("Diagnóstico copiado.", { exact: true })).toBeVisible();
	const copiedDiagnostic = await page.evaluate(
		() => (window as Window & { __copiedJobDiagnostic?: string }).__copiedJobDiagnostic,
	);
	expect(copiedDiagnostic).toContain('"schema": "tda_job_diagnostic_clipboard_v1"');
	expect(copiedDiagnostic).toContain('"failure_class": "QWEN_ALIGNMENT_TIMESTAMP_OWNED_OVERFLOW"');
	expect(copiedDiagnostic).not.toContain("OLD_ATTEMPT_EVENT");
	expect(copiedDiagnostic).not.toContain('"attempt": 1');
	expect(copiedDiagnostic).not.toContain("Alice");
	expect(copiedDiagnostic).not.toContain("context");
	expect(copiedDiagnostic).not.toContain("glossary");
	expect(copiedDiagnostic).not.toContain("token");

	await page.keyboard.press("Escape");
	await expect(inspector).not.toBeVisible();
	await expect(queueTab).toHaveAttribute("aria-selected", "true");
	await expect(search).toHaveValue("sessao-42");
	await expect(moreActions).toBeFocused();

	await page.getByRole("tab", { name: "Diagnóstico", exact: true }).click();
	await expect(page.getByRole("tab", { name: "Diagnóstico", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(
		page.getByRole("tabpanel", { name: "Diagnóstico" }),
	).toContainText("Detalhes do processamento");
});

test("main Diagnostics exposes safe recovery actions for the observed terminal job", async ({
	page,
}) => {
	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: [failedJob()],
	});

	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "Diagnóstico", exact: true }).click();

	const diagnostics = page.getByRole("tabpanel", { name: "Diagnóstico" });
	const actions = diagnostics.getByRole("group", { name: "Ações do trabalho observado" });
	await expect(actions.getByRole("button", { name: "Nova transcrição" })).toBeVisible();
	await expect(actions.getByRole("button", { name: "Repetir trabalho" })).toBeVisible();
	await expect(actions.getByRole("button", { name: "Descartar trabalho" })).toBeVisible();

	await actions.getByRole("button", { name: "Repetir trabalho" }).click();
	const retryDialog = page
		.getByRole("dialog")
		.filter({ hasText: "Repetir este trabalho?" });
	await expect(retryDialog).toBeVisible();
	await retryDialog.getByRole("button", { name: "Voltar" }).click();

	await actions.getByRole("button", { name: "Descartar trabalho" }).click();
	const discardDialog = page
		.getByRole("dialog")
		.filter({ hasText: "Descartar este trabalho?" });
	await expect(discardDialog).toContainText("Nenhum resultado concluído será removido");
	await expect(discardDialog).toContainText("evidências de Benchmark");
	await discardDialog.getByRole("button", { name: "Voltar" }).click();

	await actions.getByRole("button", { name: "Nova transcrição" }).click();
	await expect(page.getByRole("tab", { name: "Visão geral", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(page.locator("[data-craig-composer='true']")).toBeVisible();
});

test("main Diagnostics keeps non-recoverable Benchmark retry fail-closed", async ({
	page,
}) => {
	await installCompanionFixture(page, {
		benchmarkProfiles: true,
		profileReady: true,
		advanceJobs: false,
		initialJobs: [
			fixtureBenchmarkJob("failed", {
				stage: "failed",
				progress: { completed: 2, total: 4, unit: "profiles" },
				error: { code: "WORKER_PROGRESS_GAP", recoverable: false },
				result_available: false,
			}),
		],
	});

	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "Diagnóstico", exact: true }).click();

	const diagnostics = page.getByRole("tabpanel", { name: "Diagnóstico" });
	const actions = diagnostics.getByRole("group", { name: "Ações do trabalho observado" });
	await expect(
		actions.getByRole("button", { name: "Executar novo benchmark" }),
	).toBeVisible();
	await expect(
		actions.getByRole("button", { name: "Repetir tentativa" }),
	).toHaveCount(0);
	await expect(
		actions.getByRole("button", { name: "Descartar trabalho" }),
	).toBeVisible();
	await expect(diagnostics).toContainText("WORKER_PROGRESS_GAP");
});

for (const viewport of [
	{ width: 320, height: 568 },
	{ width: 360, height: 800 },
	{ width: 390, height: 844 },
	{ width: 683, height: 384 },
	{ width: 1920, height: 1080 },
	{ width: 2560, height: 1440 },
	{ width: 3840, height: 2160 },
] as const) {
	test(`per-job diagnostics stays bounded at ${viewport.width}x${viewport.height} without leaving Queue`, async ({ page }) => {
		await page.setViewportSize(viewport);
		await installCompanionFixture(page, {
			profileReady: true,
			advanceJobs: false,
			initialJobs: [failedJob()],
		});

		await page.goto("/");
		await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
		await page.getByRole("tab", { name: "Fila" }).click();
		const queue = page.getByRole("tabpanel", { name: "Fila" });
		await queue.getByRole("button", { name: "Atenção", exact: true }).click();
		await queue.getByRole("button", { name: /Mais ações para/ }).click();
		await page.getByRole("button", { name: "Abrir Diagnóstico", exact: true }).click();

		const inspector = page.locator("dialog").filter({ hasText: "Diagnóstico do processamento" });
		await expect(inspector).toBeVisible();
		const box = await inspector.boundingBox();
		expect(box).not.toBeNull();
		expect(box?.x ?? -1).toBeGreaterThanOrEqual(-1);
		expect(box?.y ?? -1).toBeGreaterThanOrEqual(-1);
		expect(box?.width ?? 999).toBeLessThanOrEqual(viewport.width + 0.1);
		expect(box?.height ?? 9999).toBeLessThanOrEqual(viewport.height + 1);
		expect(
			await inspector.evaluate(
				(element) => element.scrollWidth <= element.clientWidth + 1,
			),
		).toBeTruthy();
		const log = inspector.getByLabel("Eventos deste processamento");
		await expect(log).toBeVisible();
		const logBox = await log.boundingBox();
		expect(logBox?.height ?? 0).toBeGreaterThan(80);
		await expect(page.getByRole("tab", { name: "Fila" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
	});
}

test("Fila confirma visualmente quando o Job ID é copiado", async ({ page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: {
				writeText: async (value: string) => {
					(
						window as Window & { __copiedQueueJobId?: string }
					).__copiedQueueJobId = value;
				},
			},
		});
	});
	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: [fixtureJob("running")],
	});

	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "Fila" }).click();
	await page.getByRole("button", { name: /Mais ações para/ }).click();
	await page.getByRole("button", { name: "Copiar ID", exact: true }).click();

	const feedback = page.getByText("ID craig-job-1 copiado.", { exact: true });
	await expect(feedback).toBeVisible();
	await expect(feedback).toHaveAttribute("role", "status");
	expect(
		await page.evaluate(
			() =>
				(window as Window & { __copiedQueueJobId?: string })
					.__copiedQueueJobId,
		),
	).toBe("craig-job-1");
});

test("Fila torna falha do Clipboard API visível e acionável", async ({ page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: {
				writeText: async () => {
					throw new DOMException("denied by fixture", "NotAllowedError");
				},
			},
		});
	});
	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: [fixtureJob("running")],
	});

	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "Fila" }).click();
	await page.getByRole("button", { name: /Mais ações para/ }).click();
	await page.getByRole("button", { name: "Copiar ID", exact: true }).click();

	const feedback = page.getByText(
		"Não foi possível copiar o ID. Abra Detalhes e copie manualmente.",
		{ exact: true },
	);
	await expect(feedback).toBeVisible();
	await expect(feedback).toHaveAttribute("role", "alert");
});


test("Fila mantém a tentativa de clipboard mais nova quando respostas chegam fora de ordem", async ({
	page,
}) => {
	await page.addInitScript(() => {
		type PendingClipboardWrite = {
			value: string;
			resolve: () => void;
		};
		const pending: PendingClipboardWrite[] = [];
		(
			window as Window & {
				__queueClipboardWrites?: PendingClipboardWrite[];
			}
		).__queueClipboardWrites = pending;
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: {
				writeText: (value: string) =>
					new Promise<void>((resolve) => {
						pending.push({ value, resolve });
					}),
			},
		});
	});
	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: [
			fixtureJob("running", {
				id: "job-first",
				context: {
					campaign_id: "yuhara-main",
					session_id: "session-first",
					source_id: "source-first",
					profile_id: "qwen-quality",
				},
			}),
			fixtureJob("queued", {
				id: "job-second",
				context: {
					campaign_id: "yuhara-main",
					session_id: "session-second",
					source_id: "source-second",
					profile_id: "whisper-turbo",
				},
			}),
		],
	});

	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "Fila" }).click();
	const queue = page.getByRole("tabpanel", { name: "Fila" });
	const firstRow = queue.getByRole("row").filter({ hasText: "session-first" }).first();
	const secondRow = queue.getByRole("row").filter({ hasText: "session-second" }).first();

	await firstRow.getByRole("button", { name: /Mais ações para/ }).click();
	await page.getByRole("button", { name: "Copiar ID", exact: true }).click();
	await secondRow.getByRole("button", { name: /Mais ações para/ }).click();
	await page.getByRole("button", { name: "Copiar ID", exact: true }).click();

	await expect
		.poll(() =>
			page.evaluate(
				() =>
					(
						window as Window & {
							__queueClipboardWrites?: Array<{
								value: string;
								resolve: () => void;
							}>;
						}
					).__queueClipboardWrites?.length ?? 0,
			),
		)
		.toBe(2);

	await page.evaluate(() => {
		const writes = (
			window as Window & {
				__queueClipboardWrites?: Array<{
					value: string;
					resolve: () => void;
				}>;
			}
		).__queueClipboardWrites;
		writes?.[1]?.resolve();
	});
	await expect(page.getByText("ID job-second copiado.", { exact: true })).toBeVisible();

	await page.evaluate(() => {
		const writes = (
			window as Window & {
				__queueClipboardWrites?: Array<{
					value: string;
					resolve: () => void;
				}>;
			}
		).__queueClipboardWrites;
		writes?.[0]?.resolve();
	});
	await page.waitForTimeout(50);

	await expect(page.getByText("ID job-second copiado.", { exact: true })).toBeVisible();
	await expect(page.getByText("ID job-first copiado.", { exact: true })).toHaveCount(0);
});

test("processing header exposes one latest Companion download outside the tablist", async ({
	page,
}) => {
	const tag = "companion-rc-v0.3.16-abcdef123456";
	await page.route(
		"**/api/downloads/companion/windows/manifest?channel=latest",
		(route) =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					channel: "rc",
					version: "0.3.16",
					tag,
					minimum_api: "1",
					minimum_service_version: "0.3.14",
					asset: {
						url: `/api/downloads/companion/windows?tag=${tag}`,
						sha256: "a".repeat(64),
						size: 83_000_000,
					},
				}),
			}),
	);
	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
	});
	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();

	const download = page.getByRole("link", { name: "Baixar TDA Companion" });
	await expect(download).toBeVisible();
	await expect(download).toHaveAttribute(
		"href",
		`/api/downloads/companion/windows?tag=${tag}`,
	);
	expect(
		await download.evaluate(
			(element) => element.closest('[role="tablist"]') === null,
		),
	).toBe(true);
	await expect(
		page.getByText("Instalação e canais do TDA Companion", { exact: true }),
	).toHaveCount(0);

	const tooltip = page.locator('[role="tooltip"]');
	await download.hover();
	await expect(tooltip).toBeVisible();
	await expect(tooltip).toHaveText(
		"TDA Companion v0.3.16 · RC · Windows x64 · MSI",
	);
	const [downloadBox, tooltipBox] = await Promise.all([
		download.boundingBox(),
		tooltip.boundingBox(),
	]);
	expect(downloadBox).not.toBeNull();
	expect(tooltipBox).not.toBeNull();
	expect((tooltipBox?.x ?? 999) + (tooltipBox?.width ?? 999)).toBeLessThan(
		downloadBox?.x ?? 0,
	);
	await download.focus();
	await page.keyboard.press("Escape");
	await expect(tooltip).toBeHidden();

	await page.getByRole("tab", { name: "Fila" }).click();
	await expect(download).toBeVisible();
	await expect(download).toHaveAttribute("download", "TDACompanion-0.3.16-x64.msi");
	await page.route(`**/api/downloads/companion/windows?tag=${tag}`, (route) =>
		route.fulfill({ status: 200, contentType: "application/octet-stream", body: "synthetic installer" }),
	);
	const originalUrl = page.url();
	const downloadEvent = page.waitForEvent("download");
	await download.click();
	const installer = await downloadEvent;
	expect(installer.suggestedFilename()).toBe("TDACompanion-0.3.16-x64.msi");
	expect(page.url()).toBe(originalUrl);
	await expect(page.getByRole("tab", { name: "Fila" })).toHaveAttribute("aria-selected", "true");
});

test("latest Companion download stays reachable beside horizontally scrollable tabs on mobile", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.route(
		"**/api/downloads/companion/windows/manifest?channel=latest",
		(route) =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					channel: "stable",
					version: "0.3.15",
					tag: "companion-v0.3.15",
					minimum_api: "1",
					minimum_service_version: "0.3.14",
					asset: {
						url:
							"/api/downloads/companion/windows?tag=companion-v0.3.15",
						sha256: "a".repeat(64),
						size: 83_000_000,
					},
				}),
			}),
	);
	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
	});
	await page.goto("/");

	const download = page.getByRole("link", { name: "Baixar TDA Companion" });
	await expect(download).toBeVisible();
	const box = await download.boundingBox();
	expect(box).not.toBeNull();
	expect((box?.x ?? 999) + (box?.width ?? 999)).toBeLessThanOrEqual(390);
	expect(
		await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
	).toBe(true);
});

