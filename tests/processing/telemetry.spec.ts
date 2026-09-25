import { expect, test } from "@playwright/test";
import {
	BROWSER_TOKEN,
	fixtureJob,
	installCompanionFixture,
	LOCAL_API,
	UI_ORIGIN,
} from "./companion-fixture";

const job = {
	id: "synthetic-job",
	kind: "synthetic.fixture",
	status: "running",
	stage: "fixture",
	progress: { completed: 2, total: 3, unit: "items" },
	error: null,
	result_available: false,
	updated_at: "2026-09-20T19:20:00Z",
	attempt: 1,
	context: {
		campaign_id: "synthetic-campaign",
		session_id: "42",
		source_id: "synthetic-source",
	},
};

test("renders local resource telemetry and factual worker events after automatic session", async ({
	page,
}) => {
	await page.route(`${LOCAL_API}/**`, async (route) => {
		const path = new URL(route.request().url()).pathname;
		const authorization = route.request().headers().authorization;
		let value: unknown;

		if (path.endsWith("/health")) {
			value = {
				api_version: "1",
				service_version: "0.3.14",
				lifecycle: "ready",
			};
		} else if (path.endsWith("/session")) {
			expect(authorization).toBeUndefined();
			value = {
				schema: "tda_loopback_session_v1",
				token: BROWSER_TOKEN,
				expires_in_seconds: 300,
			};
		} else {
			expect(authorization).toBe(`Bearer ${BROWSER_TOKEN}`);
			value = path.endsWith("/capabilities")
				? {
						capabilities: [
							"synthetic.fixture",
							"job.events",
							"system.telemetry",
						],
						sync: false,
						device: { id: "test-device", label: "Acer Predator" },
						transcription: { profiles: [], catalog: [] },
					}
				: path.endsWith("/system")
					? {
							sampled_at: "2026-09-20T19:20:00Z",
							host: { os: "Windows 11", cpu: "Intel Core i7-14700HX" },
							cpu: { utilization_percent: 32 },
							memory: {
								used_bytes: 18 * 1024 ** 3,
								total_bytes: 64 * 1024 ** 3,
								percent: 28,
							},
							gpus: [
								{
									index: 0,
									name: "NVIDIA GeForce RTX 4070 Laptop GPU",
									utilization_percent: 78,
									memory_used_bytes: 6.4 * 1024 ** 3,
									memory_total_bytes: 8 * 1024 ** 3,
								},
							],
						}
					: path.endsWith("/events")
						? {
								events: [
									{
										seq: 9,
										code: "TRACK_PROGRESS",
										at: "2026-09-20T19:20:00Z",
										level: "info",
										data: {
											track: 1,
											total_tracks: 4,
											speaker: "Yuhara",
											percent: 82,
										},
									},
								],
							}
						: path.endsWith("/jobs")
							? { jobs: [job] }
							: job;
		}

		await route.fulfill({
			headers: {
				"Access-Control-Allow-Origin": UI_ORIGIN,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(value),
		});
	});

	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	const commandBar = page.getByRole("region", {
		name: "Estado e comandos do TDA Companion",
	});
	await expect(commandBar).toContainText("RTX 4070 · 78% · 6.4/8.0 GB");
	await expect(commandBar).not.toContainText("Intel Core i7-14700HX");
	await expect(page.getByText("Windows 11", { exact: false })).not.toBeVisible();
	await expect(page.getByText("Arquivo 1 de 4", { exact: true })).toBeVisible();
	await expect(page.getByText("Voz: Yuhara", { exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "Diagnóstico" }).click();
	await page.getByText("Companion e máquina", { exact: true }).click();
	await expect(page.getByText("Windows 11", { exact: true })).toBeVisible();
	await expect(page.getByText("Intel Core i7-14700HX", { exact: true })).toBeVisible();
	await expect(
		page.getByText("NVIDIA GeForce RTX 4070 Laptop GPU", { exact: false }),
	).toBeVisible();
	await expect(page.getByRole("log")).toContainText(
		"Processando voz — Yuhara · 82%.",
	);
	await expect(page.getByRole("log")).not.toContainText("cachorro");
});


test("telemetry atualiza o target factual antes do tween visual e rebaseia no sample novo", async ({
	page,
}) => {
	const state = await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: [fixtureJob("running")],
		system: {
			cpuPercent: 20,
			memoryPercent: 30,
			gpus: [
				{
					index: 0,
					name: "Synthetic GPU",
					utilizationPercent: 40,
					memoryUsedBytes: 4 * 1024 ** 3,
					memoryTotalBytes: 8 * 1024 ** 3,
				},
			],
		},
	});

	await page.goto("/");
	const gpuMetric = page.locator(
		"[data-animated-metric='true'][data-metric-label='Uso da GPU']",
	);
	const gpu = gpuMetric.getByRole("meter", { name: "Uso da GPU" });
	const visual = gpuMetric.locator("[data-animated-metric-visual='true']");
	await expect(gpu).toHaveAttribute("aria-valuenow", "40");
	await expect(visual).toHaveText("40%");

	state.setSystem({
		cpuPercent: 60,
		memoryPercent: 70,
		gpus: [
			{
				index: 0,
				name: "Synthetic GPU",
				utilizationPercent: 100,
				memoryUsedBytes: 6 * 1024 ** 3,
				memoryTotalBytes: 8 * 1024 ** 3,
			},
		],
	});
	await page.getByRole("button", { name: "Atualizar estado" }).click();

	await expect(gpu).toHaveAttribute("aria-valuenow", "100");
	await expect(gpu).toHaveAttribute("aria-valuetext", "100%");
	await expect(gpuMetric).toHaveAttribute("data-animated-running", "true");
	expect(await visual.textContent()).not.toBe("100%");

	state.setSystem({
		cpuPercent: 15,
		memoryPercent: 25,
		gpus: [
			{
				index: 0,
				name: "Synthetic GPU",
				utilizationPercent: 25,
				memoryUsedBytes: 3 * 1024 ** 3,
				memoryTotalBytes: 8 * 1024 ** 3,
			},
		],
	});
	await page.getByRole("button", { name: "Atualizar estado" }).click();

	await expect(gpu).toHaveAttribute("aria-valuenow", "25");
	await expect(gpu).toHaveAttribute("aria-valuetext", "25%");
	await expect(visual).toHaveText("25%", { timeout: 2_000 });
	await expect(gpuMetric).toHaveAttribute("data-animated-running", "false");

	const progressVisual = page.locator(
		"[data-animated-progress='true'][data-progress-label='Progresso do trabalho craig-job-1']",
	).first();
	const progress = progressVisual.getByRole("progressbar", {
		name: "Progresso do trabalho craig-job-1",
	});
	const fill = progressVisual.locator("span[aria-hidden='true']");
	expect(
		await fill.evaluate((element) => getComputedStyle(element).transitionDuration),
	).toBe("0.48s");

	state.setJob(
		fixtureJob("running", {
			progress: { completed: 2, total: 2, unit: "tracks" },
		}),
	);
	await page.getByRole("button", { name: "Atualizar estado" }).click();
	await expect(progress).toHaveAttribute("aria-valuenow", "2");
	await expect(progressVisual).toHaveAttribute("data-progress-target", "1");
});

test("reduced motion salta telemetry ao target factual e desliga transição de progresso", async ({
	page,
}) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	const state = await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: [fixtureJob("running")],
		system: {
			gpus: [
				{
					index: 0,
					name: "Synthetic GPU",
					utilizationPercent: 40,
					memoryUsedBytes: 4 * 1024 ** 3,
					memoryTotalBytes: 8 * 1024 ** 3,
				},
			],
		},
	});

	await page.goto("/");
	const gpuMetric = page.locator(
		"[data-animated-metric='true'][data-metric-label='Uso da GPU']",
	);
	const gpu = gpuMetric.getByRole("meter", { name: "Uso da GPU" });
	const visual = gpuMetric.locator("[data-animated-metric-visual='true']");
	const progressVisual = page.locator(
		"[data-animated-progress='true'][data-progress-label='Progresso do trabalho craig-job-1']",
	).first();
	const progress = progressVisual.getByRole("progressbar", {
		name: "Progresso do trabalho craig-job-1",
	});
	const fill = progressVisual.locator("span[aria-hidden='true']");

	state.setSystem({
		gpus: [
			{
				index: 0,
				name: "Synthetic GPU",
				utilizationPercent: 100,
				memoryUsedBytes: 7 * 1024 ** 3,
				memoryTotalBytes: 8 * 1024 ** 3,
			},
		],
	});
	await page.getByRole("button", { name: "Atualizar estado" }).click();

	await expect(gpu).toHaveAttribute("aria-valuenow", "100");
	await expect(gpuMetric).toHaveAttribute("data-animated-running", "false");
	await expect(visual).toHaveText("100%");
	expect(
		await fill.evaluate((element) => getComputedStyle(element).transitionDuration),
	).toBe("0s");

	state.setJob(
		fixtureJob("running", {
			progress: { completed: 2, total: 2, unit: "tracks" },
		}),
	);
	await page.getByRole("button", { name: "Atualizar estado" }).click();
	await expect(progress).toHaveAttribute("aria-valuenow", "2");
	await expect(progress).toHaveAttribute("aria-valuemax", "2");
	await expect(progressVisual).toHaveAttribute("data-progress-target", "1");
});
