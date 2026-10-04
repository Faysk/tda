import { expect, test } from "@playwright/test";
import {
	BENCHMARK_ID,
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

test("source to four-profile evidence to human-reference quality is one coherent journey", async ({
	page,
}) => {
	const state = await installCompanionFixture(page, {
		benchmarkProfiles: true,
		benchmarkEvidence: true,
		profileReady: true,
		advanceJobs: true,
	});
	const panel = await openBenchmark(page);

	await chooseZip(panel);
	await analyze(panel);
	await expect(panel.getByText("Quatro perfis prontos para o benchmark.")).toBeVisible();
	await expect(panel.getByText(/Qualidade não medida/u)).toHaveCount(0);

	await panel.getByRole("button", { name: "Executar benchmark de 5 minutos" }).click();
	await expect(panel.getByText("Benchmark em andamento")).toBeVisible();

	const refresh = page.getByRole("button", { name: "Atualizar estado" });
	for (let index = 0; index < 4; index += 1) {
		await refresh.click();
		if (state.job?.status === "succeeded") break;
	}
	await expect.poll(() => state.job?.status).toBe("succeeded");
	await expect(panel.getByText("Concluído", { exact: true })).toBeVisible();
	await expect(panel.getByText("Quatro perfis · mesma amostra")).toBeVisible();
	await expect(panel.getByText(/Qualidade não medida/u)).toBeVisible();

	expect(
		state.requests.some((item) => item.path.includes("/transcript")),
	).toBe(false);
	await panel.getByRole("button", { name: "Comparar transcripts" }).click();
	await expect(panel.getByText(/Diferença 1 de/u)).toBeVisible();
	expect(
		state.requests.some((item) => item.path.includes("/transcript")),
	).toBe(true);

	await panel.getByRole("button", { name: "Exportar evidência ZIP" }).click();
	await expect(
		panel.getByRole("group", { name: "Confirmar exportação privada" }),
	).toContainText("quatro transcripts completos");
	expect(state.requests.some((item) => item.path.endsWith("/export"))).toBe(false);
	await panel.getByRole("button", { name: "Baixar ZIP privado" }).click();
	await expect.poll(
		() => state.requests.some((item) => item.path.endsWith("/export")),
	).toBe(true);

	await panel.getByRole("button", { name: "Criar referência humana" }).click();
	const editor = panel.getByLabel("Track 1 · Alice");
	await expect(editor).toHaveValue("Olá mundo da taverna");
	await editor.fill("Olá mundo da taverna");
	await panel.getByRole("button", { name: "Salvar como referência" }).click();

	await expect(panel.getByText(/Qualidade medida · referência r1/u)).toBeVisible();
	await expect(panel.getByText("WER")).toBeVisible();
	await expect(panel.getByText("CER")).toBeVisible();
});

test("completed evidence reopens four-profile lab without turning it into Results", async ({
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

	await expect(panel.getByText("Concluído", { exact: true })).toBeVisible();
	await expect(panel.getByText("Quatro perfis · mesma amostra")).toBeVisible();
	await expect(panel.getByText(/Evidence 1111111111/u)).toBeVisible();
	await expect(panel.getByText(/Privado · local · sem áudio/u)).toBeVisible();
	await expect(
		page.getByRole("tab", { name: "Resultados" }),
	).toBeVisible();

	const compare = panel.getByRole("button", { name: "Comparar transcripts" });
	await expect(compare).toBeEnabled();
	expect(
		state.requests.some((item) => item.path.includes("/transcript")),
	).toBe(false);
	await expect(panel.getByText("Olá mundo da taverna")).toHaveCount(0);
	await expect(panel.getByText("Olá mundo na taverna")).toHaveCount(0);
	await compare.click();

	await expect(panel.getByRole("tab", { name: "Texto" })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(panel.getByText(/regiões diferentes/u)).toBeVisible();
	const leftSelector = panel.getByLabel("Esquerda");
	await leftSelector.focus();
	await page.keyboard.press("ArrowDown");
	await expect(leftSelector).toHaveValue("whisper-detailed");
	await page.keyboard.press("ArrowUp");
	await expect(leftSelector).toHaveValue("whisper-turbo");
	await expect(panel.locator('[data-kind]').first().locator("header")).not.toBeEmpty();
	await expect(panel.getByText("Olá mundo da taverna")).toBeVisible();
	await expect(panel.getByText("Olá mundo na taverna")).toBeVisible();
	await expect(panel.getByText(/Diferença 1 de/u)).toBeVisible();
	await panel.getByLabel("Filtrar track").selectOption("1");
	const nextDifference = panel.getByRole("button", { name: "Próxima diferença" });
	await nextDifference.focus();
	await page.keyboard.press("Enter");
	await expect(panel.locator('[data-current="true"]')).toBeFocused();
	await expect(panel.locator('[aria-live="polite"]')).toContainText(
		/Diferença \d+ de \d+/u,
	);
	await panel.getByLabel("Tempo inicial em segundos").fill("0");
	await panel.getByLabel("Tempo final em segundos").fill("60");
	expect(
		state.requests.some((item) =>
			item.path.includes(
				`/benchmarks/${BENCHMARK_ID}/profiles/whisper-turbo/transcript`,
			),
		),
	).toBe(true);
	expect(
		state.requests.some((item) =>
			item.path.includes(
				`/benchmarks/${BENCHMARK_ID}/profiles/qwen-quality/transcript`,
			),
		),
	).toBe(true);

	await panel.getByRole("tab", { name: "Timing" }).click();
	await expect(panel.getByText(/segmento\(s\)/u).first()).toBeVisible();

	await panel.getByRole("tab", { name: "Performance" }).click();
	await expect(panel.getByText("GPU média").first()).toBeVisible();
	await expect(panel.getByText("VRAM pico").first()).toBeVisible();

	await panel.getByRole("tab", { name: "Execução" }).click();
	await expect(panel.getByText("Transcript SHA").first()).toBeVisible();
	await expect(panel.getByText("Synthetic GPU").first()).toBeVisible();

	const horizontal = await page.evaluate(() => ({
		scrollWidth: document.documentElement.scrollWidth,
		clientWidth: document.documentElement.clientWidth,
	}));
	expect(horizontal.scrollWidth).toBeLessThanOrEqual(horizontal.clientWidth + 1);
});


test("corrupted benchmark evidence fails closed without rendering stale transcript content", async ({
	page,
}) => {
	await installCompanionFixture(page, {
		benchmarkProfiles: true,
		benchmarkEvidence: true,
		benchmarkCorruptProfile: "whisper-turbo",
		profileReady: true,
		initialJobs: [fixtureBenchmarkJob("succeeded")],
		advanceJobs: false,
	});
	const panel = await openBenchmark(page);

	await panel.getByRole("button", { name: "Comparar transcripts" }).click();
	const alert = panel.getByRole("alert");
	await expect(alert).toBeVisible();
	await expect(alert).not.toBeEmpty();
	await expect(panel.getByText("Olá mundo da taverna")).toHaveCount(0);
	await expect(panel.getByText("Olá mundo na taverna")).toHaveCount(0);
	await expect(panel.getByText(/regiões diferentes/u)).toHaveCount(0);
});

test("human reference is explicit, revisioned and unlocks objective quality only after save", async ({
	page,
}) => {
	await installCompanionFixture(page, {
		benchmarkProfiles: true,
		benchmarkEvidence: true,
		profileReady: true,
		initialJobs: [fixtureBenchmarkJob("succeeded")],
		advanceJobs: false,
	});
	const panel = await openBenchmark(page);

	await expect(panel.getByText(/Qualidade não medida/u)).toBeVisible();
	await panel.getByRole("button", { name: "Criar referência humana" }).click();
	await expect(panel.getByText("Referência humana", { exact: true })).toBeVisible();
	const editor = panel.getByLabel("Track 1 · Alice");
	await expect(editor).toHaveValue("Olá mundo da taverna");
	await editor.fill("Olá mundo da taverna");
	await panel.getByRole("button", { name: "Salvar como referência" }).click();

	await expect(panel.getByText(/Qualidade medida · referência r1/u)).toBeVisible();
	await expect(panel.getByText("WER")).toBeVisible();
	await expect(panel.getByText("CER")).toBeVisible();
	await expect(panel.getByText(/score composto/u)).toBeVisible();
	await expect(
		panel.getByRole("button", { name: "Editar referência · r1" }),
	).toBeVisible();
});

test("private export requires an explicit transcript-content disclosure", async ({ page }) => {
	const state = await installCompanionFixture(page, {
		benchmarkProfiles: true,
		benchmarkEvidence: true,
		profileReady: true,
		initialJobs: [fixtureBenchmarkJob("succeeded")],
		advanceJobs: false,
	});
	const panel = await openBenchmark(page);

	await expect(panel.getByText("Arquivos / evidências")).toBeVisible();
	await panel.getByRole("button", { name: "Exportar evidência ZIP" }).click();
	await expect(panel.getByRole("group", { name: "Confirmar exportação privada" })).toContainText(
		"quatro transcripts completos",
	);
	expect(state.requests.some((item) => item.path.endsWith("/export"))).toBe(false);

	await panel.getByRole("button", { name: "Baixar ZIP privado" }).click();
	await expect.poll(
		() => state.requests.some((item) => item.path.endsWith("/export")),
	).toBe(true);
});

test("legacy benchmark receipts stay readable without fabricated evidence", async ({
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
	await expect(panel.getByRole("button", { name: "Comparar transcripts" })).toHaveCount(0);
	await expect(panel.getByRole("button", { name: "Exportar evidência ZIP" })).toHaveCount(0);
});

test("evidence lab remains usable at a 200 percent effective browser zoom", async ({ page }) => {
	const originalViewport = page.viewportSize();
	test.skip(
		!originalViewport || originalViewport.width < 1000,
		"200% zoom gate is exercised on desktop viewports; mobile has its own 390px project",
	);
	await installCompanionFixture(page, {
		benchmarkProfiles: true,
		benchmarkEvidence: true,
		profileReady: true,
		initialJobs: [fixtureBenchmarkJob("succeeded")],
		advanceJobs: false,
	});
	const panel = await openBenchmark(page);
	await panel.getByRole("button", { name: "Comparar transcripts" }).click();

	if (!originalViewport) throw new Error("BENCHMARK_VIEWPORT_UNAVAILABLE");
	await page.setViewportSize({
		width: Math.floor(originalViewport.width / 2),
		height: Math.floor(originalViewport.height / 2),
	});
	await expect(panel.getByRole("tab", { name: "Performance" })).toBeVisible();
	await panel.getByRole("tab", { name: "Performance" }).click();
	await expect(panel.getByText("GPU média").first()).toBeVisible();

	const horizontal = await page.evaluate(() => ({
		scrollWidth: document.documentElement.scrollWidth,
		clientWidth: document.documentElement.clientWidth,
	}));
	expect(horizontal.scrollWidth).toBeLessThanOrEqual(horizontal.clientWidth + 2);
});
