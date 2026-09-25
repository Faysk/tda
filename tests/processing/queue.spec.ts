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
	await expect(page.locator("[data-processing-queue='true']")).toBeVisible();
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

	await openQueue(page);

	await expect(page.getByRole("columnheader", { name: "Sessão / source" })).toBeVisible();
	await expect(page.getByRole("columnheader", { name: "Profile" })).toBeVisible();
	await expect(page.getByRole("columnheader", { name: "Etapa / progresso" })).toBeVisible();
	await expect(page.getByRole("columnheader", { name: "Estado" })).toBeVisible();

	await expect(page.getByRole("button", { name: /Ativos/ })).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await expect(page.getByText("sessao-running", { exact: true })).toBeVisible();
	await expect(page.getByText("sessao-queued", { exact: true })).toBeVisible();
	await expect(page.getByText("sessao-cancelled", { exact: true })).not.toBeVisible();
	await expect(page.getByText("sessao-done", { exact: true })).not.toBeVisible();

	const runningRow = page
		.getByRole("row")
		.filter({ hasText: "sessao-running" });
	await expect(runningRow.getByText("Qwen Quality", { exact: true })).toBeVisible();
	await expect(runningRow.getByText("Processando", { exact: true })).toBeVisible();
	await expect(
		runningRow.getByRole("button", { name: "Cancelar trabalho" }),
	).toBeVisible();

	const queuedRow = page.getByRole("row").filter({ hasText: "sessao-queued" });
	await expect(queuedRow.getByText("Whisper Turbo", { exact: true })).toBeVisible();
	await expect(queuedRow.getByText("Na fila", { exact: true })).toBeVisible();
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

	await openQueue(page);
	await page.getByRole("button", { name: /Todos/ }).click();

	const dataRows = page.locator("tbody > tr").filter({ has: page.locator("td[data-label='Sessão / source']") });
	await expect(dataRows).toHaveCount(4);
	await expect(dataRows.first()).toContainText("sessao-zulu");

	await page.getByLabel("Ordenar").selectOption("session");
	await expect(dataRows.first()).toContainText("sessao-zulu");

	const search = page.getByLabel("Buscar");
	await search.fill("Whisper Turbo");
	await expect(page.getByText("sessao-alpha", { exact: true })).toBeVisible();
	await expect(page.getByText("sessao-zulu", { exact: true })).not.toBeVisible();
	await expect(page.getByText("1 de 4 jobs", { exact: true })).toBeVisible();

	await search.fill("");
	await page.getByRole("button", { name: /Atenção/ }).click();
	await expect(page.getByText("sessao-beta", { exact: true })).toBeVisible();
	await expect(page.getByText("sessao-alpha", { exact: true })).not.toBeVisible();
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

	await openQueue(page);
	await page.getByRole("button", { name: /Atenção/ }).click();

	const row = page.getByRole("row").filter({ hasText: "sessao-failed" }).first();
	await expect(row.getByText("Falhou", { exact: true })).toBeVisible();
	await expect(row.getByText(/Alinhamento|Qwen|alignment/i)).toBeVisible();
	await expect(
		row.getByRole("button", { name: "Repetir trabalho" }),
	).toBeVisible();

	const more = row.getByText("Mais", { exact: true });
	await expect(row.getByRole("button", { name: "Excluir" })).not.toBeVisible();
	await more.click();
	await expect(row.getByRole("button", { name: "Excluir" })).toBeVisible();

	await row.getByRole("button", { name: "Detalhes" }).click();
	await expect(page.getByText("QWEN_ALIGNMENT_REQUIRED", { exact: false })).toBeVisible();
	await expect(page.getByText("job-failed", { exact: false })).toBeVisible();
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

	await openQueue(page);

	expect(
		await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
	).toBe(true);
	await expect(page.getByLabel("Buscar")).toBeVisible();
	await expect(page.getByLabel("Ordenar")).toBeVisible();
	await expect(page.getByRole("button", { name: /Ativos/ })).toBeVisible();

	const row = page.getByRole("row").filter({ hasText: "sessao-mobile" }).first();
	await expect(row).toBeVisible();
	await expect(
		row.getByRole("button", { name: "Cancelar trabalho" }),
	).toBeVisible();
	await expect(row.getByText("Qwen Quality", { exact: true })).toBeVisible();
});
