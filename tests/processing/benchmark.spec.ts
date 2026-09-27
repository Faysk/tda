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

async function chooseZip(panel: import("@playwright/test").Locator) {
	await panel.getByLabel("ZIP Craig").setInputFiles({
		name: "benchmark-craig.zip",
		mimeType: "application/zip",
		buffer: Buffer.from("PK synthetic benchmark Craig fixture"),
	});
}

async function analyze(panel: import("@playwright/test").Locator) {
	const button = panel.getByRole("button", {
		name: "Analisar amostra localmente",
	});
	await expect(button).toBeEnabled();
	await button.click();
	await expect(panel.getByText(/Fonte validada/u)).toBeVisible();
}

test("benchmark preflights the source, prepares pending profiles, and opens its live diagnostics", async ({
	page,
}) => {
	const state = await installCompanionFixture(page, {
		benchmarkProfiles: true,
		benchmarkReadyProfiles: ["whisper-turbo", "qwen-fast"],
		advanceJobs: false,
	});
	const panel = await openBenchmark(page);

	await chooseZip(panel);
	await expect(panel).toContainText("benchmark-craig.zip");
	await expect(panel).toContainText("2 / 4 perfis prontos");
	expect(state.uploadCount).toBe(0);

	await analyze(panel);
	expect(state.uploadCount).toBe(1);
	await expect(panel.getByRole("button", { name: /Preparar 2 perfis pendentes/u })).toBeEnabled();
	await panel.getByRole("button", { name: /Preparar 2 perfis pendentes/u }).click();

	await expect.poll(() => state.preparationPostCount).toBe(2);
	expect(state.preparationProfiles).toEqual(["whisper-detailed", "qwen-quality"]);
	await expect(panel.getByText("Quatro perfis prontos para o benchmark.")).toBeVisible();

	const run = panel.getByRole("button", {
		name: "Executar benchmark de 5 minutos",
	});
	await expect(run).toBeEnabled();
	await run.click();
	await expect.poll(() => state.jobPostCount).toBe(1);
	await expect(panel.getByText("Benchmark em andamento")).toBeVisible();
	await expect(panel.getByText("0 de 4 perfis concluídos")).toBeVisible();

	await panel.getByRole("button", { name: "Ver log / Diagnóstico" }).click();
	await expect(page.getByRole("tabpanel", { name: "Diagnóstico" })).toBeVisible();
	await expect(page.getByText("benchmark-job-1", { exact: false })).toBeVisible();
	expect(
		state.requests.some((request) =>
			request.path.startsWith("/jobs/benchmark-job-1/events"),
		),
	).toBe(true);
});

test("short Craig sample is rejected during preflight before preparation or queueing", async ({
	page,
}) => {
	const state = await installCompanionFixture(page, {
		benchmarkProfiles: true,
		profileReady: true,
		benchmarkMinimumTrackDurationSeconds: 120,
		advanceJobs: false,
	});
	const panel = await openBenchmark(page);
	await chooseZip(panel);

	const analyzeButton = panel.getByRole("button", {
		name: "Analisar amostra localmente",
	});
	await analyzeButton.click();

	await expect(panel.getByRole("alert")).toContainText(
		"O benchmark exige pelo menos 5:00 em todas as tracks",
	);
	await expect(
		panel.getByRole("button", { name: "Executar benchmark de 5 minutos" }),
	).toBeDisabled();
	expect(state.preparationPostCount).toBe(0);
	expect(state.jobPostCount).toBe(0);
});

test("resource-busy rejection stays actionable beside the benchmark controls", async ({
	page,
}) => {
	const state = await installCompanionFixture(page, {
		benchmarkProfiles: true,
		profileReady: true,
		benchmarkSubmitError: "BENCHMARK_RESOURCE_BUSY",
		advanceJobs: false,
	});
	const panel = await openBenchmark(page);
	await chooseZip(panel);
	await analyze(panel);

	await panel.getByRole("button", { name: "Executar benchmark de 5 minutos" }).click();
	await expect(panel.getByRole("alert")).toContainText(
		"Há uma transcrição ou benchmark usando os recursos locais",
	);
	expect(state.jobPostCount).toBe(0);
});

test("profile preparation failure remains visible and does not create a benchmark job", async ({
	page,
}) => {
	const state = await installCompanionFixture(page, {
		benchmarkProfiles: true,
		benchmarkReadyProfiles: [
			"whisper-turbo",
			"whisper-detailed",
			"qwen-fast",
		],
		benchmarkPreparationFailureProfile: "qwen-quality",
		advanceJobs: false,
	});
	const panel = await openBenchmark(page);
	await chooseZip(panel);
	await analyze(panel);

	await panel.getByRole("button", { name: /Preparar 1 perfil pendente/u }).click();
	await expect(panel.getByRole("alert")).toContainText(
		"BENCHMARK_PREPARATION_FAILED",
	);
	expect(state.jobPostCount).toBe(0);
});

test("benchmark can be cancelled and the terminal state remains visible", async ({
	page,
}) => {
	const state = await installCompanionFixture(page, {
		benchmarkProfiles: true,
		profileReady: true,
		advanceJobs: false,
	});
	const panel = await openBenchmark(page);
	await chooseZip(panel);
	await analyze(panel);
	await panel.getByRole("button", { name: "Executar benchmark de 5 minutos" }).click();
	await expect(panel.getByText("Benchmark em andamento")).toBeVisible();

	await panel.getByRole("button", { name: "Cancelar benchmark" }).click();
	await expect.poll(() => state.job?.status).toBe("cancelled");
	await expect(panel.getByText("Benchmark cancelado")).toBeVisible();
	await expect(panel.getByRole("button", { name: "Ver log / Diagnóstico" })).toBeVisible();
});

test("completed benchmark loads a comparable receipt while failed history remains inspectable", async ({
	page,
}) => {
	const state = await installCompanionFixture(page, {
		benchmarkProfiles: true,
		profileReady: true,
		advanceJobs: true,
	});
	const panel = await openBenchmark(page);
	await chooseZip(panel);
	await analyze(panel);
	await panel.getByRole("button", { name: "Executar benchmark de 5 minutos" }).click();

	const refresh = page.getByRole("button", { name: "Atualizar estado" });
	for (let index = 0; index < 4; index += 1) {
		await refresh.click();
		if (state.job?.status === "succeeded") break;
	}
	await expect.poll(() => state.job?.status).toBe("succeeded");
	await expect(panel.getByText("Concluído", { exact: true })).toBeVisible();
	await expect(panel.getByText("Quatro perfis · mesma amostra")).toBeVisible();

	state.setJob(fixtureBenchmarkJob("failed"));
	await refresh.click();
	await expect(panel.getByText("Benchmark falhou")).toBeVisible();
	await expect(panel.getByText("BENCHMARK_PROFILE_FAILED", { exact: false })).toBeVisible();
});

test("benchmark workspace keeps source, readiness, and next action usable across target widths", async ({
	page,
}) => {
	await installCompanionFixture(page, {
		benchmarkProfiles: true,
		benchmarkReadyProfiles: ["whisper-turbo", "qwen-fast"],
		advanceJobs: false,
	});
	const panel = await openBenchmark(page);
	const sourceRegion = panel.locator('[data-benchmark-region="source"]');
	const readinessRegion = panel.locator('[data-benchmark-region="readiness"]');
	const nextAction = panel.locator('[data-benchmark-region="next-action"]');

	await expect(sourceRegion).toBeVisible();
	await expect(readinessRegion).toBeVisible();
	await expect(nextAction).toContainText("Selecione a fonte que será comparada.");
	await expect(sourceRegion.getByRole("button", { name: /Selecionar ZIP Craig Escolha/u })).toBeVisible();
	const nativeFileInput = panel.getByLabel("ZIP Craig");
	const nativeInputBox = await nativeFileInput.boundingBox();
	expect(nativeInputBox?.width ?? 0).toBeLessThanOrEqual(1);
	expect(nativeInputBox?.height ?? 0).toBeLessThanOrEqual(1);

	for (const viewport of [
		{ width: 320, height: 568 },
		{ width: 390, height: 844 },
		{ width: 1366, height: 768 },
		{ width: 1920, height: 1080 },
		{ width: 2560, height: 1440 },
		{ width: 3840, height: 2160 },
	]) {
		await page.setViewportSize(viewport);
		await expect(sourceRegion).toBeVisible();
		await expect(readinessRegion).toBeVisible();
		const hasHorizontalOverflow = await page.evaluate(
			() => document.documentElement.scrollWidth > document.documentElement.clientWidth,
		);
		expect(hasHorizontalOverflow).toBe(false);
	}

	await chooseZip(panel);
	await expect(sourceRegion).toContainText("benchmark-craig.zip");
	await expect(sourceRegion.getByRole("button", { name: "Trocar ZIP" })).toBeVisible();
	await expect(nextAction).toContainText("Valide a amostra no Companion.");
	await expect(
		nextAction.getByRole("button", { name: "Analisar amostra localmente" }),
	).toBeEnabled();
});
