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

test("Overview shows the vacant idle state when the queue is empty", async ({
	page,
}, testInfo) => {
	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
	});
	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await expect(page.getByText("Nada processando agora.")).toBeVisible();
	await expect(page.getByText("A fila local está livre.")).toBeVisible();
	await page.screenshot({
		path: testInfo.outputPath("overview-idle.png"),
		fullPage: true,
	});
});

test("Benchmark tab explains that repeatable profile comparisons are not available yet", async ({
	page,
}) => {
	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
	});
	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "Benchmark" }).click();
	const benchmark = page.getByRole("tabpanel", { name: "Benchmark" });
	await expect(benchmark).toBeVisible();
	await expect(benchmark).toContainText(
		"Benchmark comparativo ainda não disponível.",
	);
	await expect(benchmark).toContainText(
		"Os runs concluídos e suas métricas ficam em Resultados.",
	);
});
