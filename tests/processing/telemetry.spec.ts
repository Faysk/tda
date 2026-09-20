import { expect, test } from "@playwright/test";

const service = "http://127.0.0.1:8765/api/v1";
const browserToken = "browser_session_token_12345678901234567890";
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

test("automatic session renders local telemetry and factual events", async ({ page }) => {
	await page.route(service + "/**", async (route) => {
		const request = route.request();
		const path = new URL(request.url()).pathname;
		const headers = { "Access-Control-Allow-Origin": "http://127.0.0.1:3102" };
		if (path.endsWith("/health"))
			return route.fulfill({
				headers,
				json: { api_version: "1", service_version: "0.3.14", lifecycle: "ready" },
			});
		if (path.endsWith("/session"))
			return route.fulfill({
				headers,
				json: {
					schema: "tda_loopback_session_v1",
					token: browserToken,
					expires_in_seconds: 300,
				},
			});
		expect(request.headers().authorization).toBe("Bearer " + browserToken);
		const value = path.endsWith("/capabilities")
			? {
					capabilities: ["synthetic.fixture", "job.events", "system.telemetry"],
					sync: false,
					device: { id: "test-device", label: "PC sintético" },
					transcription: { profiles: [], catalog: [] },
				}
			: path.endsWith("/system")
				? {
						sampled_at: "2026-09-20T19:20:00Z",
						host: { os: "Windows 11", cpu: "Synthetic CPU" },
						cpu: { utilization_percent: 32 },
						memory: {
							used_bytes: 18 * 1024 ** 3,
							total_bytes: 64 * 1024 ** 3,
							percent: 28,
						},
						gpus: [
							{
								index: 0,
								name: "Synthetic CUDA GPU",
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
										speaker: "Alice",
										percent: 82,
									},
								},
							],
						}
					: path.endsWith("/jobs")
						? { jobs: [job] }
						: job;
		return route.fulfill({ headers, json: value });
	});

	await page.goto("/");
	await expect(page.getByText("Windows 11", { exact: false })).toBeVisible();
	await expect(page.getByText("78%", { exact: true })).toBeVisible();
	await expect(page.getByText("6.4 GB / 8.0 GB VRAM", { exact: true })).toBeVisible();
	await expect(page.getByText("Arquivo 1 de 4", { exact: true })).toBeVisible();
	await expect(page.getByText("Voz: Alice", { exact: true })).toBeVisible();
	await expect(page.getByRole("log")).toContainText("Alice");
});
