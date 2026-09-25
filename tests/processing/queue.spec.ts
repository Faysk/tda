import { expect, test } from "@playwright/test";
import {
	failedJob,
	fixtureJob,
	installCompanionFixture,
} from "./companion-fixture";

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
			.getByText(/não conseguiu gerar o alinhamento/i),
	).toBeVisible();
	await expect(
		row.getByRole("button", { name: "Repetir trabalho" }),
	).toBeVisible();

	const more = row.getByText("Mais", { exact: true });
	await expect(row.getByRole("button", { name: "Excluir" })).not.toBeVisible();
	await more.click();
	await expect(row.getByRole("button", { name: "Excluir" })).toBeVisible();

	await row.getByRole("button", { name: "Detalhes" }).click();
	await expect(queue.getByText("QWEN_ALIGNMENT_REQUIRED", { exact: false })).toBeVisible();
	await expect(queue.getByText("job-failed", { exact: false })).toBeVisible();
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
});
