import { expect, test } from "@playwright/test";
import {
	CRAIG_SOURCE_ID,
	failedJob,
	fixtureJob,
	installCompanionFixture,
	LOCAL_API,
	UI_ORIGIN,
} from "./companion-fixture";

function fulfillJson(
	route: import("@playwright/test").Route,
	value: unknown,
	status = 200,
) {
	return route.fulfill({
		status,
		headers: {
			"Access-Control-Allow-Origin": UI_ORIGIN,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(value),
	});
}

async function installCompletedRunCatalog(page: import("@playwright/test").Page) {
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
			runs: [
				{
					run_id: "run-delete-compat-1",
					status: "completed",
					source_id: CRAIG_SOURCE_ID,
					profile_id: "whisper-detailed",
					engine: "faster-whisper",
					model: "large-v3",
					model_revision: "rev",
					device: "cuda",
					completed_at: "2026-09-27T18:00:00.000Z",
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
					execution_lineage: {
						schema_version: "tda_execution_lineage_v1",
						device: "cuda",
						gpu: { model: "Synthetic GPU", vram_total_bytes: 8589934592 },
					},
				},
			],
		}),
	);
}

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
	await expect(page.getByRole("tab", { name: "Diagnóstico" })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(
		page.getByRole("heading", { name: "Detalhes do processamento" }),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Histórico de eventos" }),
	).toBeVisible();
	await expect(page.getByText("1 mais recente", { exact: true })).toBeVisible();
	await expect(page.getByRole("log")).toContainText(
		"Falha de alinhamento Qwen · faixa 1 · janela 89.",
	);
	await expect(page.getByRole("log")).toContainText(
		"Uma palavra extrapolou a janela ainda dentro da região que esta janela precisa proteger.",
	);
	await expect(page.getByRole("log")).toContainText(
		"Identidade da execução: runtime 1.0.11 · worker SHA-256",
	);
	await page.getByRole("tab", { name: "Fila" }).click();
	await page.getByRole("button", { name: "Repetir trabalho" }).click();
	await expect(page.getByRole("dialog")).toContainText(
		"checkpoints compatíveis serão reutilizados quando disponíveis",
	);
	await page.getByRole("button", { name: "Confirmar", exact: true }).click();

	await expect
		.poll(() => state.job?.attempt)
		.toBe(2);
	expect(state.job?.status).toBe("queued");
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
	await advanced.focus();
	await page.keyboard.press("Enter");
	await expect(composer.getByLabel("Contexto opcional")).not.toBeVisible();

	const restoredViewport = await page.evaluate(() => ({
		scrollHeight: document.documentElement.scrollHeight,
		clientHeight: document.documentElement.clientHeight,
	}));
	expect(restoredViewport.scrollHeight).toBeLessThanOrEqual(restoredViewport.clientHeight + 1);
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
test("Results keeps selected-run detail in document flow on Full HD", async ({ page }) => {
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
	await expect(page.getByRole("button", { name: "Revisar resultado" })).toBeVisible();
	await expect(runCard.getByText("Integridade e IDs", { exact: true })).toBeVisible();
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
					campaign_id: "synthetic",
					session_id: "session-first",
					source_id: "source-first",
					profile_id: "qwen-quality",
				},
			}),
			fixtureJob("queued", {
				id: "job-second",
				context: {
					campaign_id: "synthetic",
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
