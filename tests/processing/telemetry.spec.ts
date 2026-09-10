import { expect, test } from "@playwright/test";

const token = "synthetic_test_token_12345678901234567890";
const origin = "http://127.0.0.1:8765/api/v1";

const job = {
	id: "synthetic-job",
	kind: "synthetic.fixture",
	status: "running",
	stage: "fixture",
	progress: { completed: 2, total: 3, unit: "items" },
	error: null,
	result_available: false,
	updated_at: "2026-09-10T19:20:00Z",
	attempt: 1,
	context: {
		campaign_id: "synthetic-campaign",
		session_id: "42",
		source_id: "synthetic-source",
	},
};

test("renders local resource telemetry and jokes only from factual events", async ({ page }) => {
	await page.route(`${origin}/**`, async (route) => {
		const path = new URL(route.request().url()).pathname;
		const value = path.endsWith("/health")
			? { api_version: "1", service_version: "0.1.0", lifecycle: "ready" }
			: path.endsWith("/capabilities")
				? {
						capabilities: ["synthetic.fixture", "job.events", "system.telemetry"],
						sync: false,
						device: { id: "test-device", label: "Acer Predator" },
					}
				: path.endsWith("/system")
					? {
							sampled_at: "2026-09-10T19:20:00Z",
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
										at: "2026-09-10T19:20:00Z",
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
		await route.fulfill({
			headers: { "Access-Control-Allow-Origin": "http://127.0.0.1:3102" },
			json: value,
		});
	});

	await page.goto("/");
	await page.getByLabel("Token de pareamento").fill(token);
	await page.getByRole("button", { name: "Conectar neste computador" }).click();

	await expect(page.getByText("Windows 11", { exact: false })).toBeVisible();
	await expect(page.getByText("78%", { exact: true })).toBeVisible();
	await expect(page.getByText("6.4 GB / 8.0 GB VRAM", { exact: true })).toBeVisible();
	await expect(page.getByText("Arquivo 1 de 4", { exact: true })).toBeVisible();
	await expect(page.getByText("Voz: Yuhara", { exact: true })).toBeVisible();
	await expect(page.getByRole("log")).toContainText("Processando voz — Yuhara · 82%.");
	await expect(page.getByRole("log")).toContainText("Yuhara");
	await expect(page.getByRole("log")).not.toContainText("cachorro");
});
