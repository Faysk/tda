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
	await compare.click();

	await expect(panel.getByRole("tab", { name: "Texto" })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(panel.getByText(/regiões diferentes/u)).toBeVisible();
	await expect(panel.getByText("Olá mundo da taverna")).toBeVisible();
	await expect(panel.getByText("Olá mundo na taverna")).toBeVisible();
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
	const editor = panel.getByRole("textbox").first();
	await expect(editor).toContainText("Olá mundo da taverna");
	await editor.fill("Olá mundo da taverna");
	await panel.getByRole("button", { name: "Salvar como referência" }).click();

	await expect(panel.getByText(/Qualidade medida · referência r1/u)).toBeVisible();
	await expect(panel.getByText("WER")).toBeVisible();
	await expect(panel.getByText("CER")).toBeVisible();
	await expect(panel.getByText(/score composto/u)).toBeVisible();
	await expect(
		panel.getByRole("button", { name: "Editar referência · r1" }),
	).toBeVisible();
	await expect(panel.getByText(/vencedor/u)).toHaveCount(0);
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

test("evidence lab remains usable at a 200 percent layout zoom", async ({ page }) => {
	await installCompanionFixture(page, {
		benchmarkProfiles: true,
		benchmarkEvidence: true,
		profileReady: true,
		initialJobs: [fixtureBenchmarkJob("succeeded")],
		advanceJobs: false,
	});
	const panel = await openBenchmark(page);
	await panel.getByRole("button", { name: "Comparar transcripts" }).click();

	await page.evaluate(() => {
		document.documentElement.style.zoom = "2";
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
