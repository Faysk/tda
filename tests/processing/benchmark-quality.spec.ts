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

async function chooseAndAnalyze(panel: import("@playwright/test").Locator) {
	await panel.getByLabel("ZIP Craig").setInputFiles({
		name: "benchmark-craig.zip",
		mimeType: "application/zip",
		buffer: Buffer.from("PK synthetic benchmark quality fixture"),
	});
	const analyze = panel.getByRole("button", { name: "Analisar amostra localmente" });
	await expect(analyze).toBeEnabled();
	await analyze.click();
	await expect(panel.getByText(/Fonte validada/u)).toBeVisible();
}

async function assertNoHorizontalOverflow(page: import("@playwright/test").Page) {
	const geometry = await page.evaluate(() => ({
		scrollWidth: document.documentElement.scrollWidth,
		clientWidth: document.documentElement.clientWidth,
	}));
	expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 2);
}

test("four-profile evidence, comparison, private export and human-reference quality form one coherent local journey", async ({
	page,
}) => {
	const state = await installCompanionFixture(page, {
		benchmarkProfiles: true,
		benchmarkEvidence: true,
		benchmarkSnapshotDelayMs: 250,
		profileReady: true,
		advanceJobs: true,
	});
	const panel = await openBenchmark(page);

	await chooseAndAnalyze(panel);
	await expect(panel).toContainText("4 / 4 perfis prontos");
	await panel
		.getByRole("button", { name: "Executar benchmark de 5 minutos" })
		.click();
	await expect(panel.getByText("Benchmark em andamento")).toBeVisible();

	const refresh = page.getByRole("button", { name: "Atualizar estado" });
	for (let index = 0; index < 5; index += 1) {
		await refresh.click();
		if (state.job?.status === "succeeded") break;
	}
	await expect.poll(() => state.job?.status).toBe("succeeded");
	await expect(panel.getByText("Concluído", { exact: true })).toBeVisible();
	await expect(panel.getByText("Quatro perfis · mesma amostra")).toBeVisible();
	await expect(
		panel.getByRole("heading", { name: "Referência humana e métricas ASR" }),
	).toBeVisible();
	await expect(panel.getByText("Não medida", { exact: true })).toBeVisible();

	expect(
		state.requests.some((request) => request.path.endsWith("/snapshot")),
	).toBe(false);
	await expect(panel.getByText("Aventureiros chegam a Neverwinter")).toHaveCount(0);

	await panel.getByRole("button", { name: "Comparar transcrições" }).click();
	const evidence = panel.getByRole("region", { name: "Evidências do Benchmark" });
	await expect(evidence).toBeVisible();
	await expect(evidence.getByRole("status")).toContainText(
		"Carregando transcrições selecionadas",
	);
	await expect(evidence.getByText("Aventureiros chegam a Neverwinter")).toBeVisible();
	await expect(evidence.getByText("Aventureiros chegam a Never winter")).toBeVisible();
	expect(
		state.requests.some((request) => request.path.endsWith("/snapshot")),
	).toBe(true);

	const profileB = evidence.getByLabel("Perfil B");
	await profileB.selectOption("whisper-detailed");
	await expect(evidence.getByRole("status")).toContainText(
		"Carregando transcrições selecionadas",
	);
	await expect(profileB).toHaveValue("whisper-detailed");
	await expect
		.poll(() =>
			state.requests.some((request) =>
				request.path.endsWith("/profiles/whisper-detailed/snapshot"),
			),
		)
		.toBe(true);
	const textualDifference = evidence
		.locator('article[data-kind]:not([data-kind="equal"])')
		.first();
	await expect(textualDifference).toBeVisible();
	const differenceKind = await textualDifference.getAttribute("data-kind");
	expect(differenceKind).not.toBeNull();
	await expect(textualDifference.locator("strong").first()).toContainText(
		`· ${differenceKind ?? ""}`,
	);

	const nextDifference = evidence.getByRole("button", { name: "Próxima diferença →" });
	await nextDifference.click();
	await expect(evidence.locator('[data-active="true"]:focus')).toHaveCount(1);

	await evidence.getByRole("button", { name: "Arquivos" }).click();
	await evidence.getByRole("button", { name: "Exportar evidência privada (.zip)" }).click();
	const dialog = page
		.getByRole("dialog")
		.filter({ hasText: "Exportar evidência privada do Benchmark?" });
	await expect(dialog).toBeVisible();
	await expect(dialog).toContainText("não faz upload para a nuvem");
	await page.evaluate(() => {
		Object.defineProperty(window, "showSaveFilePicker", {
			value: undefined,
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

	await panel.getByRole("button", { name: "Abrir para correção humana" }).click();
	const track = panel.getByLabel("Track #1 · Alice");
	await expect(track).toHaveValue("Aventureiros chegam a Neverwinter");
	await track.fill("Aventureiros chegam a Neverwinter");
	await panel
		.getByRole("button", { name: "Salvar revisão e usar como referência" })
		.click();

	await expect(panel.getByText("Nenhum vencedor automático.")).toBeVisible();
	await expect(panel.getByRole("columnheader", { name: "WER" })).toBeVisible();
	await expect(panel.getByRole("columnheader", { name: "CER" })).toBeVisible();
	await expect(panel.getByText("Medida", { exact: true })).toBeVisible();
	expect(
		state.requests.some((request) =>
			request.path.endsWith("/profiles/whisper-turbo/reference-draft"),
		),
	).toBe(true);
	expect(
		state.requests.some(
			(request) =>
				request.method === "POST" && request.path.endsWith("/references"),
		),
	).toBe(true);
	expect(
		state.requests.some((request) => request.path.endsWith("/quality")),
	).toBe(true);

	await assertNoHorizontalOverflow(page);
});

test("corrupted canonical evidence fails closed instead of showing stale transcript content", async ({
	page,
}) => {
	test.skip(
		page.viewportSize()?.width !== 1366,
		"integrity negative path is viewport-invariant and runs once in the matrix",
	);
	const state = await installCompanionFixture(page, {
		benchmarkProfiles: true,
		benchmarkEvidence: true,
		benchmarkCorruptProfile: "qwen-fast",
		profileReady: true,
		initialJobs: [fixtureBenchmarkJob("succeeded")],
		advanceJobs: false,
	});
	const panel = await openBenchmark(page);

	await expect(panel.getByText("Concluído", { exact: true })).toBeVisible();
	await panel.getByRole("button", { name: "Comparar transcrições" }).click();
	await expect
		.poll(() =>
			state.requests.some(
				(request) =>
					request.path.endsWith("/profiles/qwen-fast/snapshot"),
			),
		)
		.toBe(true);
	await expect(panel.getByRole("alert")).toBeVisible();
	await expect(panel.getByText("Aventureiros chegam a Neverwinter")).toHaveCount(0);
	await expect(panel.getByText("Aventureiros chegam a Never winter")).toHaveCount(0);
});

test("historical performance-only receipts remain readable without fabricated quality", async ({
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
	await expect(
		panel.getByText(/Artefatos de transcrição não preservados nesta execução/u),
	).toBeVisible();
	await expect(
		panel.getByRole("button", { name: "Comparar transcrições" }),
	).toHaveCount(0);
	await expect(panel.getByText("Qualidade não medida.", { exact: true })).toBeVisible();
});

test("quality evidence remains keyboard-usable and overflow-free at the 200 percent zoom proxy", async ({
	page,
}) => {
	const viewport = page.viewportSize();
	test.skip(
		!viewport || viewport.width < 1000,
		"200% zoom proxy is covered on desktop projects; mobile has a dedicated 390px project",
	);
	await installCompanionFixture(page, {
		benchmarkProfiles: true,
		benchmarkEvidence: true,
		profileReady: true,
		initialJobs: [fixtureBenchmarkJob("succeeded")],
		advanceJobs: false,
	});
	const panel = await openBenchmark(page);
	await panel.getByRole("button", { name: "Comparar transcrições" }).click();
	const evidence = panel.getByRole("region", { name: "Evidências do Benchmark" });
	await expect(evidence).toBeVisible();
	await expect(evidence.getByText("Aventureiros chegam a Neverwinter")).toBeVisible();
	await expect(
		evidence.getByRole("button", { name: "Próxima diferença →" }),
	).toBeEnabled();

	if (!viewport) throw new Error("BENCHMARK_VIEWPORT_UNAVAILABLE");
	await page.setViewportSize({
		width: Math.floor(viewport.width / 2),
		height: Math.floor(viewport.height / 2),
	});
	await assertNoHorizontalOverflow(page);

	const nextDifference = evidence.getByRole("button", { name: "Próxima diferença →" });
	await nextDifference.click();
	await expect(evidence.locator('[data-active="true"]:focus')).toHaveCount(1);

	const selector = evidence.getByLabel("Perfil A");
	await selector.focus();
	await expect(selector).toBeFocused();
	await page.keyboard.press("ArrowUp");
	await expect(selector).toBeFocused();
	await expect(selector).not.toHaveValue("");
});
