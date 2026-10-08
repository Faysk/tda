import { expect, test } from "@playwright/test";
import { expectThemedSelectValue, selectThemedOption } from "../helpers/themed-select";
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
	await expect(panel).toContainText("Tentados 0/4 · Concluídos 0 · Falharam 0");

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

test("benchmark continues after a profile-local Qwen failure and finishes as Partial 3/4", async ({
	page,
}, testInfo) => {
	const profileEvents = [
		{
			seq: 1,
			attempt: 1,
			code: "BENCHMARK_PROFILE_STARTED",
			at: "2026-10-04T20:00:01Z",
			level: "info",
			data: {
				stage: "benchmark",
				profile: "whisper-turbo",
				attempted_count: 1,
				completed_count: 0,
				failed_count: 0,
			},
		},
		{
			seq: 2,
			attempt: 1,
			code: "BENCHMARK_PROFILE_COMPLETED",
			at: "2026-10-04T20:00:02Z",
			level: "info",
			data: {
				stage: "benchmark",
				profile: "whisper-turbo",
				attempted_count: 1,
				completed_count: 1,
				failed_count: 0,
			},
		},
		{
			seq: 3,
			attempt: 1,
			code: "BENCHMARK_PROFILE_STARTED",
			at: "2026-10-04T20:00:03Z",
			level: "info",
			data: {
				stage: "benchmark",
				profile: "whisper-detailed",
				attempted_count: 2,
				completed_count: 1,
				failed_count: 0,
			},
		},
		{
			seq: 4,
			attempt: 1,
			code: "BENCHMARK_PROFILE_COMPLETED",
			at: "2026-10-04T20:00:04Z",
			level: "info",
			data: {
				stage: "benchmark",
				profile: "whisper-detailed",
				attempted_count: 2,
				completed_count: 2,
				failed_count: 0,
			},
		},
		{
			seq: 5,
			attempt: 1,
			code: "BENCHMARK_PROFILE_STARTED",
			at: "2026-10-04T20:00:05Z",
			level: "info",
			data: {
				stage: "benchmark",
				profile: "qwen-fast",
				attempted_count: 3,
				completed_count: 2,
				failed_count: 0,
			},
		},
		{
			seq: 6,
			attempt: 1,
			code: "BENCHMARK_PROFILE_FAILED",
			at: "2026-10-04T20:00:06Z",
			level: "warning",
			data: {
				stage: "benchmark",
				profile: "qwen-fast",
				attempted_count: 3,
				completed_count: 2,
				failed_count: 1,
				error_code: "QWEN_ASR_EMPTY_SIGNAL_UNCERTAIN",
				recoverable: true,
				scope: "profile",
				continuation: "continue",
			},
		},
		{
			seq: 7,
			attempt: 1,
			code: "BENCHMARK_PROFILE_STARTED",
			at: "2026-10-04T20:00:07Z",
			level: "info",
			data: {
				stage: "benchmark",
				profile: "qwen-quality",
				attempted_count: 4,
				completed_count: 2,
				failed_count: 1,
			},
		},
	];
	const state = await installCompanionFixture(page, {
		benchmarkProfiles: true,
		profileReady: true,
		advanceJobs: false,
		benchmarkPartialResult: true,
		jobEvents: profileEvents,
	});
	const panel = await openBenchmark(page);
	await chooseZip(panel);
	await analyze(panel);
	await panel.getByRole("button", { name: "Executar benchmark de 5 minutos" }).click();

	state.setJob(
		fixtureBenchmarkJob("running", {
			progress: { completed: 3, total: 4, unit: "profiles" },
		}),
	);
	const refresh = page.getByRole("button", { name: "Atualizar estado" });
	await refresh.click();

	await expect(panel).toContainText(
		"Tentados 4/4 · Concluídos 2 · Falharam 1 · Pendentes 0 · Atual: Qwen Quality",
	);
	const fastLive = panel.locator("[data-state='failed']").filter({ hasText: "Qwen Fast" });
	const qualityLive = panel.locator("[data-state='running']").filter({ hasText: "Qwen Quality" });
	await expect(fastLive).toContainText("QWEN_ASR_EMPTY_SIGNAL_UNCERTAIN");
	await expect(fastLive).not.toHaveAttribute("aria-current", "step");
	await expect(qualityLive).toHaveAttribute("aria-current", "step");
	await expect(panel).toContainText(
		"O Benchmark registrou a falha deste perfil e continuará automaticamente com os perfis restantes.",
	);
	await expect(panel.getByText(/selecione Qwen Quality/iu)).toHaveCount(0);

	state.setJobEvents([
		...profileEvents,
		{
			seq: 8,
			attempt: 1,
			code: "BENCHMARK_PROFILE_COMPLETED",
			at: "2026-10-04T20:00:08Z",
			level: "info",
			data: {
				stage: "benchmark",
				profile: "qwen-quality",
				attempted_count: 4,
				completed_count: 3,
				failed_count: 1,
			},
		},
	]);
	state.setJob(
		fixtureBenchmarkJob("failed", {
			stage: "benchmark_partial",
			progress: { completed: 4, total: 4, unit: "profiles" },
			error: { code: "BENCHMARK_PARTIAL", recoverable: false },
			result_available: true,
			updated_at: "2026-10-04T20:00:09Z",
		}),
	);
	await refresh.click();

	await expect(panel.getByText("Parcial", { exact: true }).first()).toBeVisible();
	await expect(panel.getByText("3 de 4 perfis concluíram").first()).toBeVisible();
	await expect(panel.getByText("Tentados 4/4").first()).toBeVisible();
	await expect(panel.getByText("Concluídos 3").first()).toBeVisible();
	await expect(panel.getByText("Falharam 1").first()).toBeVisible();
	await panel.getByText("Tempos dos perfis concluídos").first().click();
	const measuredTable = panel.getByRole("table").filter({ hasText: "Comparação parcial de velocidade" }).first();
	await expect(measuredTable).toBeVisible();
	await expect(measuredTable.getByRole("row")).toHaveCount(4);
	await expect(measuredTable).toContainText("20.00×");
	await expect(measuredTable).not.toContainText("Qwen Fast");
	await expect(
		panel.locator("[data-state='failed']").filter({ hasText: "Qwen Fast" }).first(),
	).toContainText("QWEN_ASR_EMPTY_SIGNAL_UNCERTAIN");
	await expect(
		panel.locator("[data-state='completed']").filter({ hasText: "Qwen Quality" }).first(),
	).toBeVisible();
	await expect(panel.getByText(/selecione Qwen Quality/iu)).toHaveCount(0);
	await expect(panel.getByRole("button", { name: "Comparar transcrições" })).toHaveCount(0);

	for (const viewport of [
		{ width: 320, height: 568 },
		{ width: 683, height: 768 },
		{ width: 1920, height: 1080 },
		{ width: 2560, height: 1440 },
	]) {
		await page.setViewportSize(viewport);
		await expect(panel.getByText("Parcial", { exact: true }).first()).toBeVisible();
		await expect(panel.getByText("QWEN_ASR_EMPTY_SIGNAL_UNCERTAIN").first()).toBeVisible();
		const horizontal = await page.evaluate(() => ({
			scrollWidth: document.documentElement.scrollWidth,
			clientWidth: document.documentElement.clientWidth,
		}));
		expect(horizontal.scrollWidth).toBeLessThanOrEqual(horizontal.clientWidth + 1);
		await page.screenshot({ path: testInfo.outputPath(`partial-metrics-${viewport.width}.png`), fullPage: true });
	}

	const diagnosticsButton = panel.getByRole("button", { name: "Ver log / Diagnóstico" }).first();
	await diagnosticsButton.focus();
	await expect(diagnosticsButton).toBeFocused();
	await page.keyboard.press("Enter");
	const inspector = page
		.locator("dialog")
		.filter({ hasText: "Diagnóstico do processamento" });
	await expect(inspector).toBeVisible();
	await expect(inspector).toContainText("Perfis tentados");
	await expect(inspector).toContainText("4/4");
	await expect(inspector).toContainText("qwen-fast: failed · QWEN_ASR_EMPTY_SIGNAL_UNCERTAIN");
	await inspector.getByRole("button", { name: "Fechar" }).click();

	const rerun = panel.getByRole("button", { name: "Executar novo benchmark" }).first();
	await rerun.focus();
	await expect(rerun).toBeFocused();
	const originalKey = state.idempotencyKeys[0];
	await page.keyboard.press("Enter");
	await expect.poll(() => state.jobPostCount).toBe(2);
	expect(state.idempotencyKeys).toHaveLength(2);
	expect(state.idempotencyKeys[1]).not.toBe(originalKey);
	expect(state.job?.id).toBe("benchmark-job-2");
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
		jobEvents: [
			{
				seq: 1,
				attempt: 1,
				code: "BENCHMARK_PROFILE_STARTED",
				at: "2026-10-04T20:00:01Z",
				level: "info",
				data: {
					stage: "benchmark",
					profile: "whisper-turbo",
					attempted_count: 1,
					completed_count: 0,
					failed_count: 0,
				},
			},
		],
	});
	const panel = await openBenchmark(page);
	await chooseZip(panel);
	await analyze(panel);
	await panel.getByRole("button", { name: "Executar benchmark de 5 minutos" }).click();
	await expect(panel.getByText("Benchmark em andamento")).toBeVisible();

	await panel.getByRole("button", { name: "Cancelar benchmark" }).click();
	await expect.poll(() => state.job?.status).toBe("cancelled");
	await expect(panel.getByText("Benchmark cancelado")).toBeVisible();
	await expect(
		panel.locator("[data-state='cancelled']").filter({ hasText: "Whisper Turbo" }),
	).toBeVisible();
	await expect(
		panel.locator("[data-state='not_attempted']").filter({ hasText: "Whisper Detailed" }),
	).toBeVisible();
	await expect(
		panel.locator("[data-state='not_attempted']").filter({ hasText: "Qwen Fast" }),
	).toBeVisible();
	await expect(
		panel.locator("[data-state='not_attempted']").filter({ hasText: "Qwen Quality" }),
	).toBeVisible();
	await expect(panel.getByRole("button", { name: "Ver log / Diagnóstico" })).toBeVisible();
});

test("terminal global Benchmark failure restores failed and not-attempted profile states", async ({
	page,
}) => {
	const state = await installCompanionFixture(page, {
		benchmarkProfiles: true,
		profileReady: true,
		advanceJobs: false,
		initialJobs: [
			fixtureBenchmarkJob("failed", {
				stage: "failed",
				progress: { completed: 2, total: 4, unit: "profiles" },
				error: {
					code: "BENCHMARK_PROFILE_EVIDENCE_INVALID",
					recoverable: false,
				},
				result_available: false,
			}),
		],
		jobEvents: [
			{
				seq: 1,
				attempt: 1,
				code: "BENCHMARK_PROFILE_STARTED",
				at: "2026-10-04T20:00:01Z",
				level: "info",
				data: {
					stage: "benchmark",
					profile: "whisper-turbo",
					attempted_count: 1,
					completed_count: 0,
					failed_count: 0,
				},
			},
			{
				seq: 2,
				attempt: 1,
				code: "BENCHMARK_PROFILE_COMPLETED",
				at: "2026-10-04T20:00:02Z",
				level: "info",
				data: {
					stage: "benchmark",
					profile: "whisper-turbo",
					attempted_count: 1,
					completed_count: 1,
					failed_count: 0,
				},
			},
			{
				seq: 3,
				attempt: 1,
				code: "BENCHMARK_PROFILE_STARTED",
				at: "2026-10-04T20:00:03Z",
				level: "info",
				data: {
					stage: "benchmark",
					profile: "whisper-detailed",
					attempted_count: 2,
					completed_count: 1,
					failed_count: 0,
				},
			},
			{
				seq: 4,
				attempt: 1,
				code: "BENCHMARK_PROFILE_COMPLETED",
				at: "2026-10-04T20:00:04Z",
				level: "info",
				data: {
					stage: "benchmark",
					profile: "whisper-detailed",
					attempted_count: 2,
					completed_count: 2,
					failed_count: 0,
				},
			},
			{
				seq: 5,
				attempt: 1,
				code: "BENCHMARK_PROFILE_STARTED",
				at: "2026-10-04T20:00:05Z",
				level: "info",
				data: {
					stage: "benchmark",
					profile: "qwen-fast",
					attempted_count: 3,
					completed_count: 2,
					failed_count: 0,
				},
			},
			{
				seq: 6,
				attempt: 1,
				code: "BENCHMARK_PROFILE_FAILED",
				at: "2026-10-04T20:00:06Z",
				level: "warning",
				data: {
					stage: "benchmark",
					profile: "qwen-fast",
					attempted_count: 3,
					completed_count: 2,
					failed_count: 1,
					error_code: "BENCHMARK_PROFILE_EVIDENCE_INVALID",
					recoverable: false,
					scope: "benchmark",
					continuation: "stop",
				},
			},
		],
	});
	const panel = await openBenchmark(page);

	await expect(panel.getByText("Benchmark falhou globalmente")).toBeVisible();
	await expect(panel.getByText("Tentados 3/4")).toBeVisible();
	await expect(panel.getByText("Concluídos 2")).toBeVisible();
	await expect(panel.getByText("Falharam 1")).toBeVisible();
	await expect(panel.getByText("Pendentes 1")).toBeVisible();
	await expect(
		panel.locator("[data-state='failed']").filter({ hasText: "Qwen Fast" }),
	).toContainText("BENCHMARK_PROFILE_EVIDENCE_INVALID");
	await expect(
		panel.locator("[data-state='not_attempted']").filter({ hasText: "Qwen Quality" }),
	).toBeVisible();

	await expect(
		panel.getByRole("button", { name: "Executar novo benchmark" }),
	).toBeVisible();
	await expect(
		panel.getByRole("button", { name: "Repetir tentativa" }),
	).toHaveCount(0);
	await expect(
		panel.getByRole("button", { name: "Descartar trabalho" }),
	).toBeVisible();

	await panel.getByRole("button", { name: "Ver log / Diagnóstico" }).click();
	const inspector = page
		.locator("dialog")
		.filter({ hasText: "Diagnóstico do processamento" });
	await expect(inspector).toBeVisible();
	await expect(
		inspector.getByRole("button", { name: "Executar novo benchmark" }),
	).toBeVisible();
	await expect(
		inspector.getByRole("button", { name: "Repetir trabalho" }),
	).toHaveCount(0);
	await expect(
		inspector.getByRole("button", { name: "Descartar trabalho" }),
	).toBeVisible();
	await inspector.getByRole("button", { name: "Fechar" }).click();

	await panel.getByRole("button", { name: "Descartar trabalho" }).click();
	const confirmation = page
		.locator("dialog")
		.filter({ hasText: "Descartar este trabalho?" });
	await expect(confirmation).toBeVisible();
	await confirmation.getByRole("button", { name: "Descartar trabalho" }).click();
	await expect
		.poll(() =>
			state.requests.some(
				(request) =>
					request.method === "POST" &&
					request.path === "/jobs/benchmark-job-1/delete",
			),
		)
		.toBe(true);
	await expect(panel.getByText("Benchmark falhou globalmente")).toHaveCount(0);
});

test("recoverable global Benchmark failure retries the same job from zero progress", async ({
	page,
}) => {
	const state = await installCompanionFixture(page, {
		benchmarkProfiles: true,
		profileReady: true,
		advanceJobs: false,
		initialJobs: [
			fixtureBenchmarkJob("failed", {
				stage: "failed",
				progress: { completed: 2, total: 4, unit: "profiles" },
				error: {
					code: "WORKER_EXECUTION_FAILED",
					recoverable: true,
				},
				result_available: false,
			}),
		],
		// The real Store keeps attempt=1 until the retried job is claimed, so
		// attempt-1 events remain persisted while the retry is queued at 0/4.
		jobEvents: [
			{
				seq: 1,
				attempt: 1,
				code: "BENCHMARK_PROFILE_STARTED",
				at: "2026-10-05T20:00:01Z",
				level: "info",
				data: {
					stage: "benchmark",
					profile: "whisper-turbo",
					attempted_count: 1,
					completed_count: 0,
					failed_count: 0,
				},
			},
			{
				seq: 2,
				attempt: 1,
				code: "BENCHMARK_PROFILE_COMPLETED",
				at: "2026-10-05T20:00:02Z",
				level: "info",
				data: {
					stage: "benchmark",
					profile: "whisper-turbo",
					attempted_count: 1,
					completed_count: 1,
					failed_count: 0,
				},
			},
			{
				seq: 3,
				attempt: 1,
				code: "BENCHMARK_PROFILE_STARTED",
				at: "2026-10-05T20:00:03Z",
				level: "info",
				data: {
					stage: "benchmark",
					profile: "whisper-detailed",
					attempted_count: 2,
					completed_count: 1,
					failed_count: 0,
				},
			},
			{
				seq: 4,
				attempt: 1,
				code: "BENCHMARK_PROFILE_COMPLETED",
				at: "2026-10-05T20:00:04Z",
				level: "info",
				data: {
					stage: "benchmark",
					profile: "whisper-detailed",
					attempted_count: 2,
					completed_count: 2,
					failed_count: 0,
				},
			},
		],
	});
	const panel = await openBenchmark(page);

	const retry = panel.getByRole("button", { name: "Repetir tentativa" });
	await expect(retry).toBeVisible();
	await retry.click();

	const confirmation = page
		.locator("dialog")
		.filter({ hasText: "Repetir este trabalho?" });
	await expect(confirmation).toBeVisible();
	await confirmation.getByRole("button", { name: "Confirmar" }).click();

	await expect
		.poll(() =>
			state.requests.some(
				(request) =>
					request.method === "POST" &&
					request.path === "/jobs/benchmark-job-1/retry",
			),
		)
		.toBe(true);
	await expect(panel.getByText("Benchmark em andamento")).toBeVisible();
	await expect(panel.getByText("Aguardando worker local")).toBeVisible();
	await expect(panel).toContainText(
		"Tentados 0/4 · Concluídos 0 · Falharam 0 · Pendentes 4",
	);
	await expect(
		panel.getByText("Benchmark concluiu whisper-detailed.", { exact: true }),
	).toHaveCount(0);
	expect(state.job).toMatchObject({
		id: "benchmark-job-1",
		status: "queued",
		// Retry is queued before claim(), so the persisted attempt number still
		// refers to the previous terminal attempt. The backend tests prove claim()
		// advances it exactly once.
		attempt: 1,
		progress: { completed: 0, total: 4, unit: "profiles" },
	});
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
	await expect(panel.getByText("BENCHMARK_PROFILE_FAILED", { exact: false }).first()).toBeVisible();
	await expect(panel.getByText("sem resultado comparável", { exact: false })).toBeVisible();
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
			request.path.endsWith("/snapshot"),
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
	await selectThemedOption(page, leftSelector, "whisper-turbo");
	await expectThemedSelectValue(leftSelector, "whisper-turbo");
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
	const memory = workspace.getByText("Memória da GPU e avisos", { exact: true });
	await expect(memory.locator("..")).not.toHaveAttribute("open");
	await memory.click();
	await expect(workspace.getByText(/Pico 4\.00 GB · média 3\.00 GB/u)).toBeVisible();
	await expect(workspace.getByText(/3 amostras · cobertura 75%/u)).toBeVisible();
	await expect(workspace.getByText("VRAM não medida neste registro; nenhum valor é estimado.")).toBeVisible();

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

	await page.evaluate(() => {
		Object.defineProperty(window, "showSaveFilePicker", {
			value: () => { throw new Error("Small ZIP must use the normal browser download"); },
			configurable: true,
		});
	});
	const downloadPromise = page.waitForEvent("download");
	await dialog.getByRole("button", { name: "Exportar ZIP privado" }).click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toBe(
		"TDA-Benchmark-benchmark-benchmark-job-1-a1-private-evidence.zip",
	);
	expect(download.suggestedFilename()).not.toContain("benchmark-craig.zip");
	await expect(workspace.getByRole("status").filter({ hasText: "Download do ZIP privado iniciado" })).toBeVisible();

	// StreamingResponse does not advertise Content-Length in the installed Agent.
	await page.evaluate(() => {
		const fetchOriginal = window.fetch.bind(window);
		window.fetch = async (...args) => {
			const response = await fetchOriginal(...args);
			if (!String(args[0]).endsWith("/export.zip")) return response;
			const headers = new Headers(response.headers);
			headers.delete("content-length");
			return new Response(response.body, { status: response.status, headers });
		};
	});
	await exportButton.click();
	const chunkedDownloadPromise = page.waitForEvent("download");
	await dialog.getByRole("button", { name: "Exportar ZIP privado" }).click();
	const chunkedDownload = await chunkedDownloadPromise;
	expect(chunkedDownload.suggestedFilename()).toBe(download.suggestedFilename());
	const chunkedStream = await chunkedDownload.createReadStream();
	const downloadedChunks: Buffer[] = [];
	if (!chunkedStream) throw new Error("Downloaded ZIP stream unavailable");
	for await (const chunk of chunkedStream) downloadedChunks.push(Buffer.from(chunk));
	expect(Buffer.concat(downloadedChunks).toString()).toBe("PK synthetic private benchmark evidence");
	await expect(workspace.getByRole("status").filter({ hasText: "Download do ZIP privado iniciado" })).toBeVisible();

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

for (const outcome of ["saved", "cancelled", "failed"] as const) {
	test(`private benchmark ZIP streaming reports ${outcome} without claiming a browser download`, async ({ page }) => {
		await installCompanionFixture(page, {
			benchmarkProfiles: true, profileReady: true, benchmarkEvidence: true,
			advanceJobs: false, initialJobs: [fixtureBenchmarkJob("succeeded")],
		});
		await page.route("**/benchmarks/*/export.zip", async (route) => {
			await route.fulfill({ status: 200, headers: {
				"Access-Control-Allow-Origin": "http://127.0.0.1:3102",
				"Content-Type": "application/zip",
				"Content-Length": "16777217",
			}, body: Buffer.alloc(16 * 1024 ** 2 + 1, 80) });
		});
		const panel = await openBenchmark(page);
		await page.evaluate((result) => {
			const fetchOriginal = window.fetch.bind(window);
			window.fetch = async (...args) => {
				const response = await fetchOriginal(...args);
				if (!String(args[0]).endsWith("/export.zip")) return response;
				const headers = new Headers(response.headers);
				headers.delete("content-length");
				return new Response(response.body, { status: response.status, headers });
			};
			Object.defineProperty(window, "showSaveFilePicker", {
				configurable: true,
				value: async function (this: Window) {
					if (this !== window) throw new Error("Invalid picker receiver");
					if (result === "cancelled") throw new DOMException("Cancelled", "AbortError");
					if (result === "failed") throw new Error("Não foi possível gravar o ZIP.");
					return { createWritable: async () => new WritableStream({
						write(chunk) { document.body.dataset.exportBytes = String(Number(document.body.dataset.exportBytes ?? 0) + chunk.byteLength); },
					}) };
				},
			});
		}, outcome);
		await panel.getByRole("button", { name: "Comparar transcrições" }).click();
		const workspace = panel.getByRole("region", { name: "Evidências do Benchmark" });
		await workspace.getByRole("button", { name: "Arquivos" }).click();
		await workspace.getByRole("button", { name: "Exportar evidência privada (.zip)" }).click();
		await page.getByRole("dialog").getByRole("button", { name: "Exportar ZIP privado", exact: true }).click();
		if (outcome === "saved") {
			await expect(workspace.getByRole("status")).toContainText("ZIP privado salvo no local escolhido.");
			await expect(page.locator("body")).toHaveAttribute("data-export-bytes", "16777217");
		} else if (outcome === "cancelled") {
			await expect(workspace.getByRole("status")).toContainText("Exportação cancelada. Os arquivos locais foram preservados.");
		} else {
			await expect(workspace.getByRole("alert")).toContainText("Não foi possível gravar o ZIP.");
		}
		await expect(workspace.getByRole("button", { name: "Exportar evidência privada (.zip)" })).toBeEnabled();
		await expect(workspace.getByText("Download do ZIP privado iniciado", { exact: false })).toHaveCount(0);
	});
}
