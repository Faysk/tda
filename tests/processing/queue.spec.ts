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

function localRun(
	sourceId: string,
	runId: string,
	sha: string,
	completedAt: string,
	profileId = "whisper-detailed",
) {
	return {
		run_id: runId,
		status: "completed",
		source_id: sourceId,
		profile_id: profileId,
		engine: "faster-whisper",
		model: "large-v3",
		model_revision: "rev",
		device: "cuda",
		completed_at: completedAt,
		transcript_sha256: sha,
		transcript_size_bytes: 1200,
		stats: {
			processing_seconds: 12,
			session_duration_seconds: 60,
			duration_semantics: "session_extent_v1",
			rtf: 0.2,
			word_count: 10,
			segment_count: 2,
			track_count: 1,
			turn_count: 2,
			warning_count: 0,
		},
	};
}

function context(sessionId: string, sourceId: string, profileId: string) {
	return {
		campaign_id: "yuhara-main",
		session_id: sessionId,
		source_id: sourceId,
		profile_id: profileId,
	};
}

async function openQueue(page: import("@playwright/test").Page) {
	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "Fila" }).click();
	const queue = page.getByRole("tabpanel", { name: "Fila" });
	await expect(queue.locator("[data-processing-queue='true']")).toBeVisible();
	return queue;
}

test("fila abre em Ativos e mantém histórico terminal fora do recorte padrão", async ({
	page,
}) => {
	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: [
			fixtureJob("running", {
				context: context("sessao-running", "source-running", "qwen-quality"),
				updated_at: "2026-09-25T10:05:00Z",
			}),
			fixtureJob("queued", {
				id: "job-queued",
				context: context("sessao-queued", "source-queued", "whisper-turbo"),
				updated_at: "2026-09-25T10:04:00Z",
			}),
			failedJob({
				id: "job-failed",
				context: context("sessao-failed", "source-failed", "qwen-quality"),
				updated_at: "2026-09-25T10:03:00Z",
			}),
			fixtureJob("succeeded", {
				id: "job-done",
				context: context("sessao-done", "source-done", "whisper-turbo"),
				updated_at: "2026-09-25T10:02:00Z",
			}),
			fixtureJob("cancelled", {
				id: "job-cancelled",
				context: context("sessao-cancelled", "source-cancelled", "qwen-quality"),
				updated_at: "2026-09-25T10:01:00Z",
			}),
		],
	});

	const queue = await openQueue(page);

	await expect(queue.getByRole("columnheader", { name: "Sessão / source" })).toBeVisible();
	await expect(queue.getByRole("columnheader", { name: "Profile" })).toBeVisible();
	await expect(queue.getByRole("columnheader", { name: "Etapa / progresso" })).toBeVisible();
	await expect(queue.getByRole("columnheader", { name: "Estado" })).toBeVisible();

	if ((page.viewportSize()?.width ?? 0) > 900) {
		const header = await queue.getByRole("columnheader", { name: "Sessão / source" }).boundingBox();
		const firstRow = await queue.locator("tbody > tr[data-status]").first().boundingBox();
		expect(header).not.toBeNull();
		expect(firstRow).not.toBeNull();
		expect((firstRow?.y ?? 0) + 0.5).toBeGreaterThanOrEqual(
			(header?.y ?? 0) + (header?.height ?? 0),
		);
	}

	await expect(queue.getByRole("button", { name: /Ativos/ })).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await expect(queue.getByText("sessao-running", { exact: true })).toBeVisible();
	await expect(queue.getByText("sessao-queued", { exact: true })).toBeVisible();
	await expect(queue.getByText("sessao-cancelled", { exact: true })).not.toBeVisible();
	await expect(queue.getByText("sessao-done", { exact: true })).not.toBeVisible();

	const runningRow = queue
		.getByRole("row")
		.filter({ hasText: "sessao-running" });
	await expect(runningRow.getByText("Qwen Quality", { exact: true })).toBeVisible();
	await expect(
		runningRow
			.locator('td[data-label="Estado"]')
			.getByText("Processando", { exact: true }),
	).toBeVisible();
	await expect(
		runningRow.getByRole("button", { name: "Cancelar trabalho" }),
	).toBeVisible();

	const queuedRow = queue.getByRole("row").filter({ hasText: "sessao-queued" });
	await expect(queuedRow.getByText("Whisper Turbo", { exact: true })).toBeVisible();
	await expect(
		queuedRow
			.locator('td[data-label="Estado"]')
			.getByText("Na fila", { exact: true }),
	).toBeVisible();
});

test("filtros, busca e ordenação operam localmente sem perder running no topo", async ({
	page,
}) => {
	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: [
			fixtureJob("running", {
				context: context("sessao-zulu", "source-running", "qwen-quality"),
				updated_at: "2026-09-25T09:00:00Z",
			}),
			fixtureJob("succeeded", {
				id: "job-a",
				context: context("sessao-alpha", "source-alpha", "whisper-turbo"),
				updated_at: "2026-09-25T10:05:00Z",
			}),
			failedJob({
				id: "job-failed",
				context: context("sessao-beta", "source-beta", "qwen-quality"),
				updated_at: "2026-09-25T10:04:00Z",
			}),
			fixtureJob("cancelled", {
				id: "job-cancelled",
				context: context("sessao-gamma", "source-gamma", "qwen-quality"),
				updated_at: "2026-09-25T10:03:00Z",
			}),
		],
	});

	const queue = await openQueue(page);
	await queue.getByRole("button", { name: /Todos/ }).click();

	const dataRows = queue.locator("tbody > tr[data-status]");
	await expect(dataRows).toHaveCount(4);
	await expect(dataRows.first()).toContainText("sessao-zulu");

	await page.getByLabel("Ordenar").selectOption("session");
	await expect(dataRows.first()).toContainText("sessao-zulu");

	const search = queue.getByLabel("Buscar");
	await search.fill("Whisper Turbo");
	await expect(queue.getByText("sessao-alpha", { exact: true })).toBeVisible();
	await expect(queue.getByText("sessao-zulu", { exact: true })).not.toBeVisible();
	await expect(queue.getByText("1 de 4 jobs", { exact: true })).toBeVisible();

	await search.fill("");
	await queue.getByRole("button", { name: "Atenção", exact: true }).click();
	await expect(queue.getByText("sessao-beta", { exact: true })).toBeVisible();
	await expect(queue.getByText("sessao-alpha", { exact: true })).not.toBeVisible();
});

test("atenção mostra erro em uma linha e move ações raras para overflow", async ({
	page,
}) => {
	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: [
			failedJob({
				id: "job-failed",
				context: context("sessao-failed", "source-failed", "qwen-quality"),
			}),
		],
	});

	const queue = await openQueue(page);
	await queue.getByRole("button", { name: "Atenção", exact: true }).click();

	const row = queue.getByRole("row").filter({ hasText: "sessao-failed" }).first();
	await expect(
		row
			.locator('td[data-label="Estado"]')
			.getByText("Falhou", { exact: true }),
	).toBeVisible();
	await expect(
		row
			.locator('td[data-label="Estado"]')
			.getByText(/O alinhamento obrigatório falhou/i),
	).toBeVisible();
	await expect(
		row.getByRole("button", { name: "Repetir trabalho" }),
	).toBeVisible();

	const more = row.getByText("Mais", { exact: true });
	await expect(page.getByRole("button", { name: "Excluir", exact: true })).not.toBeVisible();
	await more.click();
	await expect(page.getByRole("button", { name: "Excluir", exact: true })).toBeVisible();

	await page.getByRole("button", { name: "Detalhes", exact: true }).click();
	await expect(queue.getByText("QWEN_ALIGNMENT_REQUIRED", { exact: false })).toBeVisible();
	await expect(queue.getByText("job-failed", { exact: false })).toBeVisible();
});

test("Abrir resultado navega para o run exato mesmo fora da primeira página", async ({
	page,
}) => {
	const targetRunId = "run-target-page-2";
	const targetSha = "d".repeat(64);
	await installCompanionFixture(page, {
		profileReady: true,
		reviewEnabled: true,
		advanceJobs: false,
		additionalCapabilities: ["transcription.runs.catalog"],
		initialJobs: [
			fixtureJob("succeeded", {
				id: "job-open-target",
				context: context(
					"sessao-open-target",
					CRAIG_SOURCE_ID,
					"whisper-detailed",
				),
			}),
		],
	});

	await page.route(`${LOCAL_API}/sources`, (route) =>
		fulfillJson(route, {
			schema_version: "tda_craig_sources_v1",
			sources: [
				{
					source_id: CRAIG_SOURCE_ID,
					source_sha256: "a".repeat(64),
					recording_id: null,
					track_count: 1,
				},
			],
		}),
	);
	await page.route(`${LOCAL_API}/runs**`, (route) => {
		const url = new URL(route.request().url());
		const cursor = url.searchParams.get("cursor");
		if (cursor === "page-2")
			return fulfillJson(route, {
				schema_version: "tda_local_run_catalog_v1",
				runs: [
					localRun(
						CRAIG_SOURCE_ID,
						targetRunId,
						targetSha,
						"2026-09-28T12:00:00Z",
					),
				],
				has_more: false,
				next_cursor: null,
			});
		return fulfillJson(route, {
			schema_version: "tda_local_run_catalog_v1",
			runs: [
				localRun(
					CRAIG_SOURCE_ID,
					"run-newer-page-1",
					"c".repeat(64),
					"2026-09-29T12:00:00Z",
				),
			],
			has_more: true,
			next_cursor: "page-2",
		});
	});
	await page.route(`${LOCAL_API}/jobs/job-open-target/result`, (route) =>
		fulfillJson(route, {
			schema_version: "tda_local_result_v1",
			campaign_id: "yuhara-main",
			session_id: "sessao-open-target",
			source_id: CRAIG_SOURCE_ID,
			job_id: "job-open-target",
			transcription: {
				schema_version: "tda_transcript_v1",
				profile_id: "whisper-detailed",
				artifact: "transcript.json",
				run_id: targetRunId,
				sha256: targetSha,
			},
			sync: { status: "not_configured" },
		}),
	);

	const queue = await openQueue(page);
	await queue.getByRole("button", { name: /Todos/ }).click();
	const targetRow = queue
		.getByRole("row")
		.filter({ hasText: "sessao-open-target" });
	await targetRow.getByRole("button", { name: "Abrir resultado" }).click();

	await expect(page.getByRole("tab", { name: "Resultados" })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	const results = page.getByRole("tabpanel", { name: "Resultados" });
	const selectedRun = results
		.getByRole("button")
		.filter({ hasText: "whisper-detailed" })
		.filter({ hasText: "12s" });
	await expect(selectedRun).toHaveAttribute("aria-current", "true");
	await expect(selectedRun).toBeFocused();
	await expect(results.getByText(`Run ${targetRunId}`, { exact: true })).toBeVisible();
	await expect(results.getByText("Revisão local derivada", { exact: true })).toHaveCount(0);
});

test("Abrir resultado mantém a Fila e mostra erro acionável quando o resultado não resolve", async ({
	page,
}) => {
	await installCompanionFixture(page, {
		profileReady: true,
		reviewEnabled: true,
		advanceJobs: false,
		additionalCapabilities: ["transcription.runs.catalog"],
		initialJobs: [
			fixtureJob("succeeded", {
				id: "job-missing-result",
				context: context(
					"sessao-missing-result",
					CRAIG_SOURCE_ID,
					"whisper-detailed",
				),
			}),
		],
	});
	await page.route(`${LOCAL_API}/sources`, (route) =>
		fulfillJson(route, {
			schema_version: "tda_craig_sources_v1",
			sources: [],
		}),
	);
	await page.route(`${LOCAL_API}/runs**`, (route) =>
		fulfillJson(route, {
			schema_version: "tda_local_run_catalog_v1",
			runs: [],
			has_more: false,
			next_cursor: null,
		}),
	);
	await page.route(`${LOCAL_API}/jobs/job-missing-result/result`, (route) =>
		fulfillJson(
			route,
			{ error: { code: "RESULT_NOT_FOUND", recoverable: false } },
			404,
		),
	);

	const queue = await openQueue(page);
	await queue.getByRole("button", { name: /Todos/ }).click();
	await queue
		.getByRole("row")
		.filter({ hasText: "sessao-missing-result" })
		.getByRole("button", { name: "Abrir resultado" })
		.click();

	await expect(page.getByRole("tab", { name: "Fila" })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(queue.getByRole("alert")).toContainText(
		"Não foi possível localizar o resultado local exato",
	);
	await expect(
		queue.getByRole("button", { name: "Abrir resultado" }),
	).toHaveText("Abrir resultado");
});

test("mobile empilha rows e mantém busca, filtros e ações sem overflow horizontal", async ({
	page,
}) => {
	await page.setViewportSize({ width: 320, height: 780 });
	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: [
			fixtureJob("running", {
				context: context("sessao-mobile", "source-mobile", "qwen-quality"),
			}),
			fixtureJob("cancelled", {
				id: "job-old-cancelled",
				context: context(
					"sessao-cancelled-mobile",
					"source-cancelled-mobile",
					"whisper-turbo",
				),
			}),
		],
	});

	const queue = await openQueue(page);

	expect(
		await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
	).toBe(true);
	await expect(queue.getByLabel("Buscar")).toBeVisible();
	await expect(queue.getByLabel("Ordenar")).toBeVisible();
	await expect(queue.getByRole("button", { name: /Ativos/ })).toBeVisible();

	const row = queue.getByRole("row").filter({ hasText: "sessao-mobile" }).first();
	await expect(row).toBeVisible();
	await expect(
		row.getByRole("button", { name: "Cancelar trabalho" }),
	).toBeVisible();
	await expect(row.getByText("Qwen Quality", { exact: true })).toBeVisible();
	await expect(row.locator('td[data-label="Attempt"]')).not.toBeVisible();
	await expect(row.locator('td[data-label="Erro / recuperação"]')).not.toBeVisible();
});
