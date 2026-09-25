import { expect, test } from "@playwright/test";
import {
	BROWSER_TOKEN,
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

function localComputer(page: import("@playwright/test").Page) {\n\treturn page.getByRole("region", { name: "Computador local" });\n}\n\ntest("renders local resource telemetry and factual worker events after automatic session", async ({
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
	await expect(localComputer(page).getByText("Pronto", { exact: true })).toBeVisible();
	await expect(page.getByText("Windows 11", { exact: false })).toBeVisible();
	await expect(page.getByText("78%", { exact: true })).toBeVisible();
	await expect(
		page.getByText("6.4 GB / 8.0 GB VRAM", { exact: true }),
	).toBeVisible();
	await expect(page.getByText("Arquivo 1 de 4", { exact: true })).toBeVisible();
	await expect(page.getByText("Voz: Yuhara", { exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "Diagnóstico" }).click();
	await expect(page.getByRole("log")).toContainText(
		"Processando voz — Yuhara · 82%.",
	);
	await expect(page.getByRole("log")).not.toContainText("cachorro");
});
