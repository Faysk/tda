import { expect, test } from "@playwright/test";
import {
	fixtureJob,
	installCompanionFixture,
	LOCAL_API,
	UI_ORIGIN,
} from "./companion-fixture";

function fulfillJson(
	route: import("@playwright/test").Route,
	value: unknown,
	status = 200,
) {
	return route.fulfill({
		status,
		headers: {
			"Access-Control-Allow-Origin": UI_ORIGIN,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(value),
	});
}

async function installSyntheticCapability(
	page: import("@playwright/test").Page,
) {
	await page.route(`${LOCAL_API}/capabilities`, (route) =>
		fulfillJson(route, {
			capabilities: [
				"transcription.craig",
				"transcription.prepare",
				"transcription.prepare.cancel",
				"job.events",
				"system.telemetry",
				"synthetic.fixture",
			],
			sync: false,
			device: { id: "fixture-pc", label: "PC sintético" },
			transcription: {
				profiles: ["qwen-quality"],
				catalog: [
					{
						id: "qwen-quality",
						engine: "qwen3",
						ready: true,
						preparation_required: false,
						reason: null,
					},
				],
				qwen_physical_gate: {
					"qwen-quality": {
						status: "ready",
						ready: true,
						profile_id: "qwen-quality",
						runtime_version: "1.0.11",
					},
				},
			},
		}),
	);
}

test("advanced diagnostics stay collapsed until explicitly opened", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: [fixtureJob("running")],
	});
	await installSyntheticCapability(page);

	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "Diagnóstico" }).click();

	const diagnostics = page.getByRole("tabpanel", { name: "Diagnóstico" });
	await expect(
		diagnostics.getByRole("heading", { name: "Detalhes do processamento" }),
	).toBeVisible();
	await expect(diagnostics.getByRole("log")).toBeVisible();

	const advanced = diagnostics
		.locator("summary")
		.filter({ hasText: "Ferramentas avançadas" });
	await expect(advanced).toBeVisible();
	await expect(
		diagnostics.getByText("Ensaio sintético", { exact: true }),
	).not.toBeVisible();

	await advanced.focus();
	await expect(advanced).toBeFocused();
	await page.keyboard.press("Enter");

	await expect(
		diagnostics.getByText("Ensaio sintético", { exact: true }),
	).toBeVisible();
	await expect(
		diagnostics.getByRole("button", { name: "Executar ensaio sintético" }),
	).toBeVisible();

	const dimensions = await page.evaluate(() => ({
		scrollWidth: document.documentElement.scrollWidth,
		clientWidth: document.documentElement.clientWidth,
	}));
	expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
});
