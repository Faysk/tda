import { expect, test } from "@playwright/test";
import {
	fixtureBenchmarkJob,
	installCompanionFixture,
} from "./companion-fixture";

async function openBenchmark(page: import("@playwright/test").Page) {
	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "Benchmark" }).click();
	const panel = page.getByRole("tabpanel", { name: "Benchmark" });
	await expect(panel).toBeVisible();
	return panel;
}

async function assertNoHorizontalOverflow(page: import("@playwright/test").Page) {
	const horizontal = await page.evaluate(() => ({
		scrollWidth: document.documentElement.scrollWidth,
		clientWidth: document.documentElement.clientWidth,
	}));
	expect(horizontal.scrollWidth).toBeLessThanOrEqual(horizontal.clientWidth + 2);
}

test("completed benchmark reopens verified evidence lazily and keeps comparison keyboard-operable", async ({
	page,
}) => {
	const state = await installCompanionFixture(page, {
		benchmarkProfiles: true,
		benchmarkEvidence: true,
		profileReady: true,
		initialJobs: [fixtureBenchmarkJob("succeeded")],
		advanceJobs: false,
	});
	const panel = await openBenchmark(page);

	await expect(panel.getByText("Quatro perfis · mesma amostra")).toBeVisible();
	await expect(panel.getByText(/Qualidade não medida/u)).toBeVisible();
	expect(
		state.requests.some((request) => request.path.includes("/snapshot")),
	).toBe(false);

	await panel.getByRole("button", { name: "Comparar transcrições" }).click();
	const workspace = panel.getByRole("region", { name: "Evidências do Benchmark" });
	await expect(workspace).toBeVisible();
	await expect(workspace.getByText("Aventureiros chegam a Neverwinter")).toBeVisible();
	await expect(workspace.getByText("Aventureiros chegam a Never winter")).toBeVisible();
	expect(
		state.requests.some((request) => request.path.includes("/snapshot")),
	).toBe(true);

	const leftSelector = workspace.getByLabel("Perfil A");
	await leftSelector.focus();
	await page.keyboard.press("ArrowDown");
	await expect(leftSelector).not.toHaveValue("qwen-fast");
	await page.keyboard.press("ArrowUp");

	const nextDifference = workspace.getByRole("button", {
		name: "Próxima diferença →",
	});
	await nextDifference.focus();
	await page.keyboard.press("Enter");
	await expect(workspace.locator('[data-active="true"]:focus')).toHaveCount(1);

	await workspace.getByRole("button", { name: "Arquivos" }).click();
	await workspace
		.getByRole("button", { name: "Exportar evidência privada (.zip)" })
		.click();
	const dialog = page
		.getByRole("dialog")
		.filter({ hasText: "Exportar evidência privada do Benchmark?" });
	await expect(dialog).toBeVisible();
	await expect(dialog).toContainText("não faz upload para a nuvem");
	await expect(dialog).toContainText(/transcri/i);

	await assertNoHorizontalOverflow(page);
	const viewport = page.viewportSize();
	if (viewport && viewport.width >= 1000) {
		await page.setViewportSize({
			width: Math.floor(viewport.width / 2),
			height: viewport.height,
		});
		await assertNoHorizontalOverflow(page);
	}
});

test("corrupted canonical evidence fails closed without stale transcript content", async ({
	page,
}) => {
	await installCompanionFixture(page, {
		benchmarkProfiles: true,
		benchmarkEvidence: true,
		benchmarkCorruptProfile: "qwen-fast",
		profileReady: true,
		initialJobs: [fixtureBenchmarkJob("succeeded")],
		advanceJobs: false,
	});
	const panel = await openBenchmark(page);

	await panel.getByRole("button", { name: "Comparar transcrições" }).click();
	const workspace = panel.getByRole("region", { name: "Evidências do Benchmark" });
	const alert = workspace.getByRole("alert");
	await expect(alert).toBeVisible();
	await expect(alert).not.toBeEmpty();
	await expect(workspace.getByText("Aventureiros chegam a Neverwinter")).toHaveCount(0);
	await expect(workspace.getByText("Aventureiros chegam a Never winter")).toHaveCount(0);
});

test("human reference explicitly unlocks WER and CER without an automatic winner", async ({
	page,
}) => {
	await installCompanionFixture(page, {
		benchmarkProfiles: true,
		benchmarkEvidence: true,
		benchmarkQuality: true,
		profileReady: true,
		initialJobs: [fixtureBenchmarkJob("succeeded")],
		advanceJobs: false,
	});
	const panel = await openBenchmark(page);

	await expect(panel.getByText("Referência humana e métricas ASR")).toBeVisible();
	await expect(panel.getByText("Criar referência Level 1")).toBeVisible();
	await expect(panel.getByText("Não medida", { exact: true })).toBeVisible();

	await panel.getByRole("button", { name: "Abrir para correção humana" }).click();
	const reference = panel.getByLabel("Track #1 · Alice");
	await expect(reference).toHaveValue("Aventureiros chegam a Neverwinter");
	await reference.fill("Aventureiros chegam a Neverwinter");
	await panel
		.getByRole("button", { name: "Salvar revisão e usar como referência" })
		.click();

	await expect(panel.getByText("Medida", { exact: true })).toBeVisible();
	await expect(panel.getByText("Nenhum vencedor automático.")).toBeVisible();
	await expect(panel.getByRole("columnheader", { name: "WER" })).toBeVisible();
	await expect(panel.getByRole("columnheader", { name: "CER" })).toBeVisible();
	await expect(panel.getByText(/Referência r1/u)).toBeVisible();
});

test("historical performance-only receipts remain readable without fabricated artifacts", async ({
	page,
}) => {
	await installCompanionFixture(page, {
		benchmarkProfiles: true,
		profileReady: true,
		initialJobs: [fixtureBenchmarkJob("succeeded")],
		advanceJobs: false,
	});
	const panel = await openBenchmark(page);

	await expect(panel.getByText("Concluído", { exact: true })).toBeVisible();
	await expect(panel.getByText(/Evidência detalhada indisponível/u)).toBeVisible();
	await expect(
		panel.getByRole("button", { name: "Comparar transcrições" }),
	).toHaveCount(0);
	await expect(panel.getByText(/Nenhum WER foi inventado retroativamente/u)).toHaveCount(0);
});
