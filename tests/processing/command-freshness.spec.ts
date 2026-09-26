import { expect, test } from "@playwright/test";
import { fixtureJob, installCompanionFixture, LOCAL_API, UI_ORIGIN } from "./companion-fixture";

for (const domain of ["system", "sources", "events"] as const) {
	test(`${domain} failure only marks its owning surface stale`, async ({ page }) => {
		await installCompanionFixture(page, { profileReady: true, advanceJobs: false, reviewEnabled: true,
			initialJobs: [fixtureJob("running")] });
		await page.goto("/");
		const bar = page.locator("[data-processing-command-bar='true']");
		await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
		const path = domain === "events" ? `${LOCAL_API}/jobs/*/events` : `${LOCAL_API}/${domain}`;
		await page.route(path, (route) => route.abort("failed"));
		await page.getByRole("button", { name: "Atualizar estado", exact: true }).click();
		if (domain === "system") {
			await expect(bar.getByText("Dados desatualizados", { exact: true })).toBeVisible();
			await expect(bar).toContainText("CPU 25%");
		} else {
			await page.getByRole("tab", { name: domain === "sources" ? "Resultados" : "Diagnóstico", exact: true }).click();
			await expect(page.getByText(domain === "sources" ? /Resultados desatualizados/ : /Eventos desatualizados/)).toBeVisible();
			await expect(bar).not.toContainText("Dados desatualizados");
		}
		await page.unroute(path);
		await page.getByRole("button", { name: "Atualizar estado", exact: true }).click();
		await expect(page.getByText(/Resultados desatualizados|Eventos desatualizados/)).toHaveCount(0);
		await expect(bar).not.toContainText("Dados desatualizados");
	});
}

test("machine GPU label is deterministic when inventory order differs", async ({ page }) => {
	await installCompanionFixture(page, { profileReady: true, system: { gpus: [
		{ index: 1, name: "NVIDIA RTX Second", utilizationPercent: 95, memoryUsedBytes: 1, memoryTotalBytes: 2 },
		{ index: 0, name: "NVIDIA RTX Primary", utilizationPercent: 10, memoryUsedBytes: 1, memoryTotalBytes: 2 },
	] } });
	await page.goto("/");
	const bar = page.locator("[data-processing-command-bar='true']");
	await expect(bar).toContainText("GPU 0 · RTX Primary · 10%");
	await expect(bar).not.toContainText("RTX Second");
	await expect(bar.getByTitle("GPU 0 da máquina · NVIDIA RTX Primary")).toBeVisible();
});

test("explicit failure diagnostics survive polling while another job runs", async ({ page }) => {
	const jobs = [
		fixtureJob("running", { id: "running-b" }),
		fixtureJob("failed", { id: "failed-a", error: { code: "QWEN_ALIGNMENT_REQUIRED", recoverable: true } }),
	];
	await installCompanionFixture(page, { profileReady: true, advanceJobs: false, initialJobs: jobs });
	await page.route(`${LOCAL_API}/jobs`, (route) => route.fulfill({
		headers: { "Access-Control-Allow-Origin": UI_ORIGIN }, json: { jobs },
	}));
	let failureReads = 0, runningReads = 0;
	await page.route(`${LOCAL_API}/jobs/*/events`, async (route) => {
		const failure = route.request().url().includes("/failed-a/");
		if (failure) failureReads += 1; else runningReads += 1;
		await route.fulfill({ headers: { "Access-Control-Allow-Origin": UI_ORIGIN }, json: { events: [{
			seq: 1, at: "2026-09-26T00:00:00Z", level: failure ? "error" : "info",
			code: failure ? "QWEN_ALIGNMENT_WINDOW_FAILED" : "TRACK_PROGRESS",
			data: failure ? { track: 2, window: 89, failure_class: "QWEN_ALIGNMENT_TIMESTAMP_OWNED_OVERFLOW" }
				: { track: 1, total_tracks: 2, speaker: "Synthetic B", percent: 25 },
		}] } });
	});
	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "Fila", exact: true }).click();
	await page.getByRole("button", { name: "Atenção", exact: true }).click();
	await page.getByRole("button", { name: /Mais ações para/ }).click();
	await page.getByRole("button", { name: "Abrir Diagnóstico", exact: true }).click();
	await expect(page.getByRole("log")).toContainText("faixa 2 · janela 89");
	const inspectedReads = failureReads;
	await expect.poll(() => failureReads).toBeGreaterThan(inspectedReads);
	await expect(page.getByRole("log")).toContainText("faixa 2 · janela 89");
	await expect(page.getByRole("log")).not.toContainText("Synthetic B");
	const priorRunningReads = runningReads;
	await page.getByRole("tab", { name: "Visão geral", exact: true }).click();
	await expect.poll(() => runningReads).toBeGreaterThan(priorRunningReads);
	await expect(page.getByRole("tabpanel", { name: "Visão geral" })).not.toContainText("janela 89");
});
