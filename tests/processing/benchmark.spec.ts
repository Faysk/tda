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

test("benchmark repairs one stale Qwen runtime for both profiles without requiring a Craig ZIP", async ({
	page,
}) => {
	const state = await installCompanionFixture(page, {
		benchmarkProfiles: true,
		benchmarkReadyProfiles: ["whisper-turbo", "whisper-detailed"],
		qwenRuntimeUpgradeRequired: true,
		qwenRuntimeVersion: "1.0.11",
		qwenRuntimeStableVersion: "1.0.12",
		advanceJobs: false,
	});
	const panel = await openBenchmark(page);

	await expect(panel).toContainText("2 / 4 perfis prontos");
	await expect(panel.getByText("Runtime Qwen precisa ser atualizado.")).toHaveCount(2);
	const recovery = panel.locator("[data-qwen-runtime-recovery='true']");
	await expect(recovery).toBeVisible();
	await expect(recovery).toContainText("Instalado");
	await expect(recovery).toContainText("1.0.11");
	await expect(recovery).toContainText("≥ 1.0.12");
	await expect(recovery).toContainText("Stable disponível");
	await expect(recovery).toContainText("1.0.12");
	await expect.poll(() => state.qwenRuntimeCheckPostCount).toBe(1);

	const update = recovery.getByRole("button", { name: "Atualizar Qwen Runtime" });
	await expect(update).toBeEnabled();
	await update.click();

	await expect.poll(() => state.qwenRuntimeUpdatePostCount).toBe(1);
	await expect(panel).toContainText("4 / 4 perfis prontos");
	await expect(
		panel.getByText("Qwen Runtime atualizado. Qwen Fast e Qwen Quality estão prontos."),
	).toBeVisible();
	await expect(recovery).toHaveCount(0);
	expect(state.uploadCount).toBe(0);
	expect(state.preparationPostCount).toBe(0);
});

test("benchmark can recover a Qwen runtime when the installed version is unknown", async ({
	page,
}) => {
	const state = await installCompanionFixture(page, {
		benchmarkProfiles: true,
		benchmarkReadyProfiles: ["whisper-turbo", "whisper-detailed"],
		qwenRuntimeUpgradeRequired: true,
		qwenRuntimeVersion: null,
		qwenRuntimeStableVersion: "1.0.12",
		advanceJobs: false,
	});
	const panel = await openBenchmark(page);

	await expect(panel).toContainText("2 / 4 perfis prontos");
	await expect(panel.getByText("Runtime Qwen precisa ser verificado.")).toHaveCount(2);
	await expect(
		panel.locator("[data-state='blocked']").filter({ hasText: "Qwen Fast" }),
	).toBeVisible();
	const recovery = panel.locator("[data-qwen-runtime-recovery='true']");
	await expect(recovery).toBeVisible();
	await expect(recovery).toContainText("Não identificado");
	await expect(recovery).toContainText("≥ 1.0.12");
	await expect(recovery).toContainText("1.0.12");
	await expect.poll(() => state.qwenRuntimeCheckPostCount).toBe(1);

	const update = recovery.getByRole("button", { name: "Atualizar Qwen Runtime" });
	await expect(update).toBeEnabled();
	await update.click();

	await expect.poll(() => state.qwenRuntimeUpdatePostCount).toBe(1);
	await expect(panel).toContainText("4 / 4 perfis prontos");
	await expect(recovery).toHaveCount(0);
	expect(state.uploadCount).toBe(0);
	expect(state.preparationPostCount).toBe(0);
});

test("Qwen runtime recovery stays readable and keyboard-operable on mobile", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const state = await installCompanionFixture(page, {
		benchmarkProfiles: true,
		benchmarkReadyProfiles: ["whisper-turbo", "whisper-detailed"],
		qwenRuntimeUpgradeRequired: true,
		qwenRuntimeVersion: "1.0.11",
		qwenRuntimeStableVersion: "1.0.12",
		advanceJobs: false,
	});
	const panel = await openBenchmark(page);
	const recovery = panel.locator("[data-qwen-runtime-recovery='true']");

	await expect(recovery).toBeVisible();
	await expect(panel.getByText("Runtime Qwen precisa ser atualizado.")).toHaveCount(2);
	const technical = panel.getByText("Detalhe técnico").first();
	await technical.click();
	await expect(
		panel.getByText("QWEN_RUNTIME_ALIGNMENT_UPGRADE_REQUIRED").first(),
	).toBeVisible();

	const horizontal = await page.evaluate(() => ({
		scrollWidth: document.documentElement.scrollWidth,
		clientWidth: document.documentElement.clientWidth,
	}));
	expect(horizontal.scrollWidth).toBeLessThanOrEqual(horizontal.clientWidth + 1);

	const update = recovery.getByRole("button", { name: "Atualizar Qwen Runtime" });
	await update.focus();
	await expect(update).toBeFocused();
	await page.keyboard.press("Enter");

	await expect.poll(() => state.qwenRuntimeUpdatePostCount).toBe(1);
	await expect(panel).toContainText("4 / 4 perfis prontos");
});

test("benchmark does not offer a false update when installed runtime already meets the minimum", async ({
	page,
}) => {
	const state = await installCompanionFixture(page, {
		benchmarkProfiles: true,
		benchmarkReadyProfiles: ["whisper-turbo", "whisper-detailed"],
		qwenRuntimeUpgradeRequired: true,
		qwenRuntimeVersion: "1.0.12",
		qwenRuntimeStableVersion: "1.0.12",
		advanceJobs: false,
	});
	const panel = await openBenchmark(page);
	const recovery = panel.locator("[data-qwen-runtime-recovery='true']");

	await expect.poll(() => state.qwenRuntimeCheckPostCount).toBe(1);
	await expect(recovery).toContainText("Instalado");
	await expect(recovery).toContainText("1.0.12");
	await expect(recovery).toContainText(
		"O runtime instalado já não está abaixo da Stable compatível.",
	);
	await expect(
		recovery.getByRole("button", { name: "Atualizar Qwen Runtime" }),
	).toHaveCount(0);
	await expect(panel).toContainText(
		"O runtime não oferece update; abra Diagnóstico para investigar o blocker.",
	);
	expect(state.qwenRuntimeUpdatePostCount).toBe(0);
});

test("benchmark fails closed when the Stable Qwen runtime is below the required minimum", async ({
	page,
}) => {
	const state = await installCompanionFixture(page, {
		benchmarkProfiles: true,
		benchmarkReadyProfiles: ["whisper-turbo", "whisper-detailed"],
		qwenRuntimeUpgradeRequired: true,
		qwenRuntimeVersion: "1.0.10",
		qwenRuntimeStableVersion: "1.0.11",
	});
	const panel = await openBenchmark(page);
	const recovery = panel.locator("[data-qwen-runtime-recovery='true']");

	await expect.poll(() => state.qwenRuntimeCheckPostCount).toBe(1);
	await expect(recovery).toContainText("1.0.11 · abaixo do mínimo");
	await expect(recovery).toContainText(
		"A Stable publicada ainda não atende ao mínimo exigido.",
	);
	await expect(
		recovery.getByRole("button", { name: "Atualizar Qwen Runtime" }),
	).toHaveCount(0);
	expect(state.qwenRuntimeUpdatePostCount).toBe(0);
});

test("benchmark does not promise a Qwen update when the Stable manifest cannot be verified", async ({
	page,
}) => {
	const state = await installCompanionFixture(page, {
		benchmarkProfiles: true,
		benchmarkReadyProfiles: ["whisper-turbo", "whisper-detailed"],
		qwenRuntimeUpgradeRequired: true,
		qwenRuntimeVersion: "1.0.11",
		qwenRuntimeManifestUnavailable: true,
	});
	const panel = await openBenchmark(page);
	const recovery = panel.locator("[data-qwen-runtime-recovery='true']");

	await expect.poll(() => state.qwenRuntimeCheckPostCount).toBe(1);
	await expect(recovery).toContainText("Não foi possível confirmar");
	await expect(
		recovery.getByRole("button", { name: "Atualizar Qwen Runtime" }),
	).toHaveCount(0);
	await expect(
		recovery.getByRole("button", { name: "Verificar novamente" }),
	).toBeEnabled();
	expect(state.qwenRuntimeUpdatePostCount).toBe(0);
});


test("benchmark resumes an update that was already running before the page opened", async ({
	page,
}) => {
	const state = await installCompanionFixture(page, {
		benchmarkProfiles: true,
		benchmarkReadyProfiles: ["whisper-turbo", "whisper-detailed"],
		qwenRuntimeUpgradeRequired: true,
		qwenRuntimeVersion: "1.0.11",
		qwenRuntimeStableVersion: "1.0.12",
		qwenRuntimeUpdateInitiallyActive: true,
		advanceJobs: false,
	});
	const panel = await openBenchmark(page);

	await expect(panel).toContainText("2 / 4 perfis prontos");
	const recovery = panel.locator("[data-qwen-runtime-recovery='true']");
	await expect(recovery).toContainText("Atualizando");
	await expect(recovery).toContainText("Baixando Qwen Runtime…");
	await expect.poll(() => state.qwenRuntimeStatusGetCount).toBeGreaterThanOrEqual(2);
	await expect(panel).toContainText("4 / 4 perfis prontos");
	await expect(
		panel.getByText("Qwen Runtime atualizado. Qwen Fast e Qwen Quality estão prontos."),
	).toBeVisible();
	await expect(recovery).toHaveCount(0);
	expect(state.qwenRuntimeCheckPostCount).toBe(0);
	expect(state.qwenRuntimeUpdatePostCount).toBe(0);
	expect(state.uploadCount).toBe(0);
});

test("benchmark reconciles a Qwen update that completed before the first status poll", async ({
	page,
}) => {
	const state = await installCompanionFixture(page, {
		benchmarkProfiles: true,
		benchmarkReadyProfiles: ["whisper-turbo", "whisper-detailed"],
		qwenRuntimeUpgradeRequired: true,
		qwenRuntimeVersion: "1.0.11",
		qwenRuntimeStableVersion: "1.0.12",
		qwenRuntimeUpdateInitiallyCompleted: true,
		advanceJobs: false,
	});
	const panel = await openBenchmark(page);

	await expect(panel).toContainText("4 / 4 perfis prontos");
	await expect(
		panel.getByText("Qwen Runtime atualizado. Qwen Fast e Qwen Quality estão prontos."),
	).toBeVisible();
	await expect(panel.locator("[data-qwen-runtime-recovery='true']")).toHaveCount(0);
	expect(state.qwenRuntimeStatusGetCount).toBeGreaterThanOrEqual(1);
	expect(state.qwenRuntimeCheckPostCount).toBe(0);
	expect(state.qwenRuntimeUpdatePostCount).toBe(0);
	expect(state.uploadCount).toBe(0);
});

test("benchmark keeps update failure actionable and sanitized", async ({ page }) => {
	const state = await installCompanionFixture(page, {
		benchmarkProfiles: true,
		benchmarkReadyProfiles: ["whisper-turbo", "whisper-detailed"],
		qwenRuntimeUpgradeRequired: true,
		qwenRuntimeVersion: "1.0.11",
		qwenRuntimeStableVersion: "1.0.12",
		qwenRuntimeUpdateFailure: "QWEN_RUNTIME_UPDATE_FAILED",
	});
	const panel = await openBenchmark(page);
	const recovery = panel.locator("[data-qwen-runtime-recovery='true']");

	await expect.poll(() => state.qwenRuntimeCheckPostCount).toBe(1);
	await recovery.getByRole("button", { name: "Atualizar Qwen Runtime" }).click();

	await expect.poll(() => state.qwenRuntimeUpdatePostCount).toBe(1);
	await expect(recovery.getByRole("alert")).toContainText("QWEN_RUNTIME_UPDATE_FAILED");
	await expect(recovery.getByRole("alert")).toContainText(
		"Não foi possível atualizar o Qwen Runtime",
	);
	await expect(
		recovery.getByRole("button", { name: "Atualizar Qwen Runtime" }),
	).toBeEnabled();
	await expect(panel).toContainText("2 / 4 perfis prontos");
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

test("Whisper 1.1.9 stays transcription-ready but requires benchmark evidence runtime", async ({
	page,
}) => {
	const state = await installCompanionFixture(page, {
		benchmarkProfiles: true,
		profileReady: true,
		whisperBenchmarkRuntimeUpgradeRequired: true,
		advanceJobs: false,
	});
	const panel = await openBenchmark(page);

	await expect(panel).toContainText("2 / 4 perfis prontos para benchmark");
	await expect(
		panel.getByText("Whisper Runtime precisa ser atualizado para benchmark."),
	).toHaveCount(2);

	await chooseZip(panel);
	await analyze(panel);
	const prepare = panel.getByRole("button", {
		name: /Preparar 2 perfis pendentes/u,
	});
	await expect(prepare).toBeEnabled();
	await prepare.click();

	await expect.poll(() => state.preparationPostCount).toBe(2);
	await expect(panel).toContainText("4 / 4 perfis prontos para benchmark");
	await expect(
		panel.getByRole("button", { name: "Executar benchmark de 5 minutos" }),
	).toBeEnabled();
	expect(state.jobPostCount).toBe(0);
});

test("Qwen 1.0.17 stays transcription-ready but requires benchmark evidence runtime", async ({
	page,
}) => {
	const state = await installCompanionFixture(page, {
		benchmarkProfiles: true,
		profileReady: true,
		qwenBenchmarkRuntimeUpgradeRequired: true,
		qwenRuntimeVersion: "1.0.17",
		advanceJobs: false,
	});
	const panel = await openBenchmark(page);

	await expect(panel).toContainText("2 / 4 perfis prontos para benchmark");
	await expect(
		panel.getByText("Qwen Runtime precisa ser atualizado para benchmark."),
	).toHaveCount(2);

	await chooseZip(panel);
	await analyze(panel);
	const prepare = panel.getByRole("button", {
		name: /Preparar 2 perfis pendentes/u,
	});
	await expect(prepare).toBeEnabled();
	await prepare.click();

	await expect.poll(() => state.preparationPostCount).toBe(2);
	await expect(panel).toContainText("4 / 4 perfis prontos para benchmark");
	await expect(
		panel.getByRole("button", { name: "Executar benchmark de 5 minutos" }),
	).toBeEnabled();
	expect(state.jobPostCount).toBe(0);
});

test("benchmark fails closed when Companion lacks the runtime-readiness-v2 contract", async ({
	page,
}) => {
	const state = await installCompanionFixture(page, {
		benchmarkProfiles: true,
		profileReady: true,
		benchmarkReadinessContract: false,
		advanceJobs: false,
	});
	const panel = await openBenchmark(page);

	await expect(panel).toContainText("0 / 4 perfis prontos para benchmark");
	await expect(panel).toContainText(
		"Atualize o Companion para habilitar o contrato de prontidão do benchmark.",
	);
	await chooseZip(panel);
	await analyze(panel);
	await expect(
		panel.getByRole("button", { name: "Executar benchmark de 5 minutos" }),
	).toHaveCount(0);
	expect(state.preparationPostCount).toBe(0);
	expect(state.jobPostCount).toBe(0);
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
	await expect(
		panel.getByText(/Artefatos de transcrição não preservados nesta execução/u),
	).toBeVisible();
	await expect(
		panel.getByRole("button", { name: "Comparar transcrições" }),
	).toHaveCount(0);

	state.setJob(fixtureBenchmarkJob("failed"));
	await refresh.click();
	await expect(panel.getByText("Benchmark falhou")).toBeVisible();
	await expect(panel.getByText("BENCHMARK_PROFILE_FAILED", { exact: false })).toBeVisible();
});

test("completed benchmark lazily compares transcript evidence and exports a private safe ZIP", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const state = await installCompanionFixture(page, {
		benchmarkProfiles: true,
		profileReady: true,
		benchmarkEvidence: true,
		advanceJobs: false,
		initialJobs: [fixtureBenchmarkJob("succeeded")],
	});

	const panel = await openBenchmark(page);
	await expect(panel.getByText("Quatro perfis · mesma amostra")).toBeVisible();
	await expect(
		panel.getByRole("button", { name: "Comparar transcrições" }),
	).toBeVisible();
	expect(
		state.requests.some((request) =>
			request.path.startsWith("/benchmarks/"),
		),
	).toBe(false);

	await panel.getByRole("button", { name: "Comparar transcrições" }).click();

	const workspace = panel.getByRole("region", { name: "Evidências do Benchmark" });
	await expect(workspace).toBeVisible();
	await expect(workspace.getByText("Qualidade não medida.")).toBeVisible();
	await expect(workspace.getByText("Aventureiros chegam a Neverwinter")).toBeVisible();
	await expect(workspace.getByText("Aventureiros chegam a Never winter")).toBeVisible();
	await expect(
		workspace.getByText(/1 \/ 1|1 \/ 2/u),
	).toBeVisible();
	expect(
		state.requests.some((request) =>
			request.path.endsWith("/profiles/qwen-fast/snapshot"),
		),
	).toBe(true);
	expect(
		state.requests.some((request) =>
			request.path.endsWith("/profiles/qwen-quality/snapshot"),
		),
	).toBe(true);
	expect(
		state.requests.some((request) =>
			request.path.endsWith("/profiles/whisper-turbo/snapshot"),
		),
	).toBe(false);

	await workspace.getByRole("tab", { name: "Timing" }).click();
	await expect(workspace.getByText(/Precisão palavra/u).first()).toBeVisible();
	await expect(workspace.getByText(/Δ início/u).first()).toBeVisible();

	await workspace.getByRole("button", { name: "Próxima diferença →" }).click();
	await expect(
		workspace.locator('[data-active="true"]:focus'),
	).toHaveCount(1);

	const leftSelector = workspace.getByLabel("Perfil A");
	await leftSelector.selectOption("whisper-turbo");
	await expect(leftSelector).toHaveValue("whisper-turbo");
	await expect
		.poll(() =>
			state.requests.some((request) =>
				request.path.endsWith("/profiles/whisper-turbo/snapshot"),
			),
		)
		.toBe(true);

	await workspace.getByRole("tab", { name: "Performance" }).click();
	await expect(workspace.getByText("Comparabilidade: comprovada")).toBeVisible();
	await expect(workspace.getByRole("columnheader", { name: "RTF" })).toBeVisible();

	await workspace.getByRole("tab", { name: "Execução" }).click();
	await expect(workspace.getByText("NVIDIA GeForce RTX 4070 Laptop GPU").first()).toBeVisible();
	await expect(workspace.getByText(/1\.0\.18|1\.1\.10/u).first()).toBeVisible();

	await workspace.getByRole("button", { name: "Arquivos" }).click();
	await expect(workspace.getByText("Arquivos privados locais.")).toBeVisible();
	await expect(workspace.getByRole("button", { name: "JSON" })).toHaveCount(4);
	await expect(workspace.getByRole("button", { name: "TXT", exact: true })).toHaveCount(4);
	await expect(workspace.getByRole("button", { name: "TXT simples" })).toHaveCount(4);
	await expect(workspace.getByRole("button", { name: "VTT" })).toHaveCount(4);
	await expect(workspace.getByRole("button", { name: "SRT" })).toHaveCount(4);

	const exportButton = workspace.getByRole("button", {
		name: "Exportar evidência privada (.zip)",
	});
	await exportButton.click();
	const dialog = page
		.getByRole("dialog")
		.filter({ hasText: "Exportar evidência privada do Benchmark?" });
	await expect(dialog).toBeVisible();
	await expect(dialog).toContainText("não faz upload para a nuvem");

	const downloadPromise = page.waitForEvent("download");
	await dialog.getByRole("button", { name: "Exportar ZIP privado" }).click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toBe(
		"TDA-Benchmark-benchmark-benchmark-job-1-a1-private-evidence.zip",
	);
	expect(download.suggestedFilename()).not.toContain("benchmark-craig.zip");

	const assertNoHorizontalOverflow = async () => {
		const horizontal = await page.evaluate(() => ({
			scrollWidth: document.documentElement.scrollWidth,
			clientWidth: document.documentElement.clientWidth,
		}));
		expect(horizontal.scrollWidth).toBeLessThanOrEqual(horizontal.clientWidth + 1);
	};
	await assertNoHorizontalOverflow();

	await page.setViewportSize({ width: 1366, height: 768 });
	await assertNoHorizontalOverflow();

	// 683 CSS px is the existing browser-level proxy for a 1366px viewport at 200% zoom.
	await page.setViewportSize({ width: 683, height: 768 });
	await assertNoHorizontalOverflow();
});