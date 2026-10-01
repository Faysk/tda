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

test("benchmark foregrounds source, readiness, and only the next available action", async ({
	page,
}) => {
	await installCompanionFixture(page, {
		benchmarkProfiles: true,
		profileReady: true,
		advanceJobs: false,
	});
	const panel = await openBenchmark(page);

	const sourceRegion = panel.getByRole("region", { name: "Amostra Craig" });
	const readinessRegion = panel.getByRole("region", { name: "Perfis locais" });
	const picker = panel.locator("[data-benchmark-source-picker='true']");
	await expect(sourceRegion).toBeVisible();
	await expect(readinessRegion).toBeVisible();
	await expect(picker).toHaveAttribute("data-selected", "false");
	await expect(picker).toContainText("Selecionar ZIP Craig");
	await expect(panel).toContainText("4 / 4 perfis prontos");
	await expect(
		panel.getByRole("button", { name: "Analisar amostra localmente" }),
	).toHaveCount(0);

	const nativeInput = panel.getByLabel("ZIP Craig");
	const nativeGeometry = await nativeInput.evaluate((element) => {
		const rect = element.getBoundingClientRect();
		const style = getComputedStyle(element);
		return {
			width: rect.width,
			height: rect.height,
			position: style.position,
			clipPath: style.clipPath,
		};
	});
	expect(nativeGeometry.width).toBeLessThanOrEqual(1);
	expect(nativeGeometry.height).toBeLessThanOrEqual(1);
	expect(nativeGeometry.position).toBe("absolute");
	expect(nativeGeometry.clipPath).not.toBe("none");

	await chooseZip(panel);
	await expect(picker).toHaveAttribute("data-selected", "true");
	await expect(picker).toContainText("benchmark-craig.zip");
	await expect(
		panel.getByRole("button", { name: "Analisar amostra localmente" }),
	).toBeEnabled();
	await expect(
		panel.getByRole("button", { name: "Executar benchmark de 5 minutos" }),
	).toHaveCount(0);

	await analyze(panel);
	await expect(
		panel.getByRole("button", { name: "Analisar amostra localmente" }),
	).toHaveCount(0);
	await expect(
		panel.getByRole("button", { name: "Executar benchmark de 5 minutos" }),
	).toBeEnabled();
});

test("benchmark preflight reflows from mobile through 4K without horizontal overflow", async ({
	page,
}, testInfo) => {
	await installCompanionFixture(page, {
		benchmarkProfiles: true,
		profileReady: true,
		advanceJobs: false,
	});

	for (const viewport of [
		{ width: 320, height: 568 },
		{ width: 390, height: 844 },
		{ width: 960, height: 540 },
		{ width: 1366, height: 768 },
		{ width: 1920, height: 1080 },
		{ width: 2560, height: 1440 },
		{ width: 3840, height: 2160 },
	]) {
		await page.setViewportSize(viewport);
		const panel = await openBenchmark(page);
		const sourceRegion = panel.getByRole("region", { name: "Amostra Craig" });
		const readinessRegion = panel.getByRole("region", { name: "Perfis locais" });
		await expect(sourceRegion).toBeVisible();
		await expect(readinessRegion).toBeVisible();

		const horizontal = await page.evaluate(() => ({
			scrollWidth: document.documentElement.scrollWidth,
			clientWidth: document.documentElement.clientWidth,
		}));
		expect(horizontal.scrollWidth).toBeLessThanOrEqual(horizontal.clientWidth + 1);

		const sourceBox = await sourceRegion.boundingBox();
		const readinessBox = await readinessRegion.boundingBox();
		expect(sourceBox).not.toBeNull();
		expect(readinessBox).not.toBeNull();
		if (!sourceBox || !readinessBox) throw new Error("Benchmark preflight bounds unavailable");
		if (viewport.width > 1000) {
			expect(readinessBox.x).toBeGreaterThanOrEqual(sourceBox.x + sourceBox.width - 1);
		} else {
			expect(readinessBox.y).toBeGreaterThanOrEqual(sourceBox.y + sourceBox.height - 1);
		}

		if ([320, 1920, 3840].includes(viewport.width)) {
			await page.screenshot({
				path: testInfo.outputPath(`benchmark-${viewport.width}x${viewport.height}.png`),
				fullPage: true,
			});
		}
	}
});

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

	const diagnosticsButton = panel.getByRole("button", { name: "Ver log / Diagnóstico" });
	await diagnosticsButton.click();
	await expect(page.getByRole("tab", { name: "Benchmark" })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	const inspector = page
		.locator("dialog")
		.filter({ hasText: "Diagnóstico do processamento" });
	await expect(inspector).toBeVisible();
	await expect(inspector).toContainText("benchmark-job-1");
	expect(
		state.requests.some((request) =>
			request.path.startsWith("/jobs/benchmark-job-1/events"),
		),
	).toBe(true);
	await inspector.getByRole("button", { name: "Fechar" }).click();
	await expect(inspector).not.toBeVisible();
	await expect(diagnosticsButton).toBeFocused();
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
	).toHaveCount(0);
	await expect(
		panel.getByText("Esta fonte não possui 5:00 válidos em todas as tracks."),
	).toBeVisible();
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

test("stale Qwen runtime is recoverable once for Fast and Quality without selecting a ZIP", async ({
	page,
}) => {
	const state = await installCompanionFixture(page, {
		benchmarkProfiles: true,
		profileReady: true,
		qwenRuntimeVersion: "1.0.11",
		qwenRuntimeStableVersion: "1.0.12",
		advanceJobs: false,
	});
	const panel = await openBenchmark(page);

	await expect(panel).toContainText("2 / 4 perfis prontos");
	await expect(panel).toContainText("Runtime Qwen precisa ser atualizado.");
	await expect(panel).toContainText("Instalado: 1.0.11 · necessário: ≥ 1.0.12");
	await expect(panel).toContainText("Stable: 1.0.12");
	await expect(panel.getByLabel("ZIP Craig")).toHaveValue("");

	const update = panel.getByRole("button", { name: "Atualizar Qwen Runtime" });
	await expect(update).toHaveCount(1);
	await expect(update).toBeEnabled();
	await update.click();

	await expect.poll(() => state.qwenRuntimeUpdatePostCount).toBe(1);
	await expect(panel.getByText(/Qwen Runtime 1\.0\.12 atualizado/u)).toBeVisible();
	await expect(panel).toContainText("4 / 4 perfis prontos");
	await expect(
		panel.getByRole("button", { name: "Atualizar Qwen Runtime" }),
	).toHaveCount(0);
	expect(
		state.requests.filter((request) => request.path === "/runtime/qwen" && request.method === "POST"),
	).toHaveLength(1);
});

test("benchmark keeps Qwen fail-closed when Stable is below the required minimum", async ({
	page,
}) => {
	await installCompanionFixture(page, {
		benchmarkProfiles: true,
		profileReady: true,
		qwenRuntimeVersion: "1.0.10",
		qwenRuntimeStableVersion: "1.0.11",
		advanceJobs: false,
	});
	const panel = await openBenchmark(page);

	await expect(panel).toContainText("2 / 4 perfis prontos");
	await expect(panel).toContainText("Stable: 1.0.11");
	await expect(panel).toContainText(
		"A Stable publicada ainda não atende o mínimo exigido",
	);
	await expect(
		panel.getByRole("button", { name: /atualizar Qwen Runtime/i }),
	).toHaveCount(0);
});

test("benchmark does not promise a Qwen update when the Stable manifest is unavailable", async ({
	page,
}) => {
	await installCompanionFixture(page, {
		benchmarkProfiles: true,
		profileReady: true,
		qwenRuntimeVersion: "1.0.11",
		qwenRuntimeManifestUnavailable: true,
		advanceJobs: false,
	});
	const panel = await openBenchmark(page);

	await expect(panel).toContainText("Stable: não foi possível validar");
	await expect(panel).toContainText(
		"Manifest Stable indisponível. O Companion não vai prometer nem iniciar uma atualização sem validação.",
	);
	await expect(
		panel.getByRole("button", { name: /atualizar Qwen Runtime/i }),
	).toHaveCount(0);
});

test("Qwen runtime update failure stays sanitized, retryable, and independent from Craig", async ({
	page,
}) => {
	const state = await installCompanionFixture(page, {
		benchmarkProfiles: true,
		profileReady: true,
		qwenRuntimeVersion: "1.0.11",
		qwenRuntimeStableVersion: "1.0.12",
		qwenRuntimeUpdateError: "QWEN_RUNTIME_PART_SIZE_MISMATCH",
		advanceJobs: false,
	});
	const panel = await openBenchmark(page);

	const update = panel.getByRole("button", { name: "Atualizar Qwen Runtime" });
	await update.click();
	await expect(panel.getByRole("alert")).toContainText(
		"QWEN_RUNTIME_PART_SIZE_MISMATCH",
	);
	await expect(panel.getByRole("alert")).toContainText(
		"Tente novamente; se persistir, abra Diagnóstico.",
	);
	expect(state.uploadCount).toBe(0);
	expect(state.qwenRuntimeUpdatePostCount).toBe(1);

	await expect(update).toBeEnabled();
	await update.click();
	await expect.poll(() => state.qwenRuntimeUpdatePostCount).toBe(2);
});

test("Qwen recovery remains usable on mobile and exposes the technical reason as diagnosis", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await installCompanionFixture(page, {
		benchmarkProfiles: true,
		profileReady: true,
		qwenRuntimeVersion: "1.0.11",
		qwenRuntimeStableVersion: "1.0.12",
		advanceJobs: false,
	});
	const panel = await openBenchmark(page);

	await expect(panel.getByText("Diagnóstico: QWEN_RUNTIME_ALIGNMENT_UPGRADE_REQUIRED")).toHaveCount(2);
	const update = panel.getByRole("button", { name: "Atualizar Qwen Runtime" });
	await expect(update).toBeVisible();
	await update.focus();
	await expect(update).toBeFocused();

	const horizontal = await page.evaluate(() => ({
		scrollWidth: document.documentElement.scrollWidth,
		clientWidth: document.documentElement.clientWidth,
	}));
	expect(horizontal.scrollWidth).toBeLessThanOrEqual(horizontal.clientWidth + 1);
});
