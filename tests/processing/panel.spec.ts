import { expect, test } from "@playwright/test";

const service = "http://127.0.0.1:8765/api/v1";
const uiOrigin = "http://127.0.0.1:3102";
const browserToken = "browser_session_token_12345678901234567890";

const runningJob = {
	id: "synthetic-job",
	kind: "synthetic.fixture",
	status: "running",
	stage: "fixture",
	progress: { completed: 1, total: 3, unit: "items" },
	error: null,
	result_available: false,
	updated_at: "2026-09-20T18:00:00Z",
	attempt: 1,
	context: {
		campaign_id: "synthetic-campaign",
		session_id: "synthetic-session",
		source_id: "synthetic-source",
	},
};

function cors() {
	return {
		"Access-Control-Allow-Origin": uiOrigin,
		"Content-Type": "application/json",
	};
}

test("automatic browser session shows real progress and cancel stays contextual", async ({
	page,
}) => {
	let job = { ...runningJob };
	const mutations: string[] = [];
	let sessionCalls = 0;

	await page.route(service + "/**", async (route) => {
		const request = route.request();
		const path = new URL(request.url()).pathname;
		if (path.endsWith("/health")) {
			expect(request.headers().authorization).toBeUndefined();
			return route.fulfill({
				headers: cors(),
				json: { api_version: "1", service_version: "0.3.14", lifecycle: "ready" },
			});
		}
		if (path.endsWith("/session")) {
			sessionCalls += 1;
			expect(request.method()).toBe("POST");
			expect(request.headers().authorization).toBeUndefined();
			return route.fulfill({
				headers: cors(),
				json: {
					schema: "tda_loopback_session_v1",
					token: browserToken,
					expires_in_seconds: 300,
				},
			});
		}

		expect(request.headers().authorization).toBe("Bearer " + browserToken);
		if (request.method() === "POST") {
			mutations.push(path);
			if (path.endsWith("/cancel"))
				job = { ...job, status: "cancelled", stage: "cancelled" };
		}
		const value = path.endsWith("/capabilities")
			? {
					capabilities: ["synthetic.fixture"],
					sync: false,
					device: { id: "test-device", label: "PC sintético" },
					transcription: { profiles: [], catalog: [] },
				}
			: path.endsWith("/jobs")
				? { jobs: [job] }
				: job;
		return route.fulfill({ headers: cors(), json: value });
	});

	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	expect(sessionCalls).toBe(1);
	await expect(page.getByRole("progressbar")).toHaveAttribute("value", "1");
	await expect(page.getByRole("progressbar")).toHaveAttribute("max", "3");

	await page.getByRole("button", { name: "Cancelar trabalho" }).first().click();
	await expect(page.getByRole("dialog")).toContainText("synthetic-job");
	expect(mutations).toEqual([]);
	await page.getByRole("button", { name: "Confirmar", exact: true }).click();
	await expect(page.locator("li .ds-status")).toHaveText("Cancelado");
	expect(mutations).toEqual(["/api/v1/jobs/synthetic-job/cancel"]);

	await expect(
		page.getByText("Sincronização não configurada.", { exact: true }),
	).toBeVisible();
	expect(
		await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
	).toBe(true);
});

test("API and service-version incompatibilities stop before requesting a browser token", async ({
	page,
}) => {
	let mode: "api" | "version" = "api";
	let sessionCalls = 0;

	await page.route(service + "/**", async (route) => {
		const path = new URL(route.request().url()).pathname;
		if (path.endsWith("/session")) {
			sessionCalls += 1;
			return route.fulfill({
				headers: cors(),
				json: {
					schema: "tda_loopback_session_v1",
					token: browserToken,
					expires_in_seconds: 300,
				},
			});
		}
		if (path.endsWith("/health")) {
			return route.fulfill({
				headers: cors(),
				json:
					mode === "api"
						? { api_version: "2", service_version: "0.3.99", lifecycle: "ready" }
						: { api_version: "1", service_version: "0.3.13", lifecycle: "ready" },
			});
		}
		throw new Error("unexpected request: " + path);
	});

	await page.goto("/");
	await expect(page.getByText("API incompatível", { exact: true })).toBeVisible();
	await expect(page.getByRole("alert")).toContainText("API v2");
	expect(sessionCalls).toBe(0);

	mode = "version";
	await page.getByRole("button", { name: "Tentar novamente" }).click();
	await expect(page.getByText("Atualização necessária", { exact: true })).toBeVisible();
	await expect(page.getByRole("alert")).toContainText("v0.3.13");
	await expect(page.getByRole("alert")).toContainText("v0.3.14");
	expect(sessionCalls).toBe(0);
});

test("offline Companion produces actionable loopback diagnosis", async ({ page }) => {
	await page.route(service + "/**", (route) => route.abort("failed"));
	await page.goto("/");
	await expect(page.getByRole("alert")).toContainText(
		"Não foi possível alcançar o serviço",
	);
	await expect(page.getByRole("alert")).toContainText("rede local");
});

test("expired browser bearer is renewed automatically", async ({ page }) => {
	let sessionCalls = 0;
	let expireNextProtectedRead = false;

	await page.route(service + "/**", async (route) => {
		const request = route.request();
		const path = new URL(request.url()).pathname;
		if (path.endsWith("/health"))
			return route.fulfill({
				headers: cors(),
				json: { api_version: "1", service_version: "0.3.14", lifecycle: "ready" },
			});
		if (path.endsWith("/session")) {
			sessionCalls += 1;
			return route.fulfill({
				headers: cors(),
				json: {
					schema: "tda_loopback_session_v1",
					token: browserToken + String(sessionCalls),
					expires_in_seconds: 300,
				},
			});
		}
		if (expireNextProtectedRead) {
			expireNextProtectedRead = false;
			return route.fulfill({
				status: 401,
				headers: cors(),
				json: { error: { code: "UNAUTHORIZED", recoverable: true } },
			});
		}
		if (path.endsWith("/capabilities"))
			return route.fulfill({
				headers: cors(),
				json: {
					capabilities: [],
					sync: false,
					device: { id: "renew-device", label: "PC renovável" },
					transcription: { profiles: [], catalog: [] },
				},
			});
		if (path.endsWith("/jobs"))
			return route.fulfill({ headers: cors(), json: { jobs: [] } });
		throw new Error("unexpected request: " + path);
	});

	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	expect(sessionCalls).toBe(1);

	expireNextProtectedRead = true;
	await page.getByRole("button", { name: "Atualizar estado" }).click();
	await expect.poll(() => sessionCalls).toBe(2);
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
});

test("recoverable failure exposes retry without claiming completion", async ({ page }) => {
	let retried = false;
	await page.route(service + "/**", async (route) => {
		const request = route.request();
		const path = new URL(request.url()).pathname;
		if (path.endsWith("/health"))
			return route.fulfill({
				headers: cors(),
				json: { api_version: "1", service_version: "0.3.14", lifecycle: "ready" },
			});
		if (path.endsWith("/session"))
			return route.fulfill({
				headers: cors(),
				json: {
					schema: "tda_loopback_session_v1",
					token: browserToken,
					expires_in_seconds: 300,
				},
			});
		if (path.endsWith("/capabilities"))
			return route.fulfill({
				headers: cors(),
				json: {
					capabilities: [],
					sync: false,
					device: { id: "test-device", label: "PC sintético" },
					transcription: { profiles: [], catalog: [] },
				},
			});
		const failed = {
			...runningJob,
			status: retried ? "queued" : "interrupted",
			stage: retried ? "queued" : "interrupted",
			progress: { completed: 0, total: 3, unit: "items" },
			error: retried ? null : { code: "PROCESS_INTERRUPTED", recoverable: true },
		};
		if (path.endsWith("/retry") && request.method() === "POST") {
			retried = true;
			return route.fulfill({
				headers: cors(),
				json: { ...failed, status: "queued", stage: "queued", error: null },
			});
		}
		return route.fulfill({
			headers: cors(),
			json: path.endsWith("/jobs") ? { jobs: [failed] } : failed,
		});
	});

	await page.goto("/");
	await expect(page.getByText("Precisam de atenção")).toBeVisible();
	await page.getByRole("button", { name: "Repetir trabalho" }).click();
	await expect(page.getByRole("dialog")).toContainText("nova tentativa");
	await page.getByRole("button", { name: "Confirmar", exact: true }).click();
	await expect(page.getByText("A seguir na fila")).toBeVisible();
});
