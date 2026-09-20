import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { expect, test } from "@playwright/test";

const masterToken = "synthetic_integration_token_12345678901234567890";
const service = "http://127.0.0.1:18765/api/v1";
const uiOrigin = "http://127.0.0.1:3102";
let child: ChildProcess;

test.beforeAll(async () => {
	const python = process.env.TDA_COMPANION_PYTHON;
	const packageRoot = process.env.TDA_COMPANION_PACKAGE;
	if (!python || !packageRoot)
		throw new Error(
			"Set TDA_COMPANION_PYTHON and TDA_COMPANION_PACKAGE to the isolated Companion test runtime/package.",
		);
	try {
		await fetch(service + "/health", { signal: AbortSignal.timeout(500) });
		throw new Error("TEST_PORT_IN_USE: refusing to reuse another service");
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("TEST_PORT"))
			throw error;
	}
	await mkdir("test-results", { recursive: true });
	const scratch = await mkdtemp(resolve("test-results/companion-"));
	const tokenPath = join(scratch, "synthetic-token.txt");
	await writeFile(tokenPath, masterToken);
	child = spawn(
		python,
		[
			"-m",
			"tda_companion",
			"--data-root",
			join(scratch, "data"),
			"--token-file",
			tokenPath,
			"--origin",
			uiOrigin,
			"--origin",
			"https://tda-ui.test",
			"--port",
			"18765",
		],
		{ cwd: packageRoot, windowsHide: true, stdio: "pipe" },
	);
	let launchError = "";
	child.on("error", (error) => {
		launchError = error.message;
	});
	await expect
		.poll(
			async () => {
				if (launchError) throw new Error(launchError);
				try {
					return (await fetch(service + "/health")).status;
				} catch {
					return 0;
				}
			},
			{ timeout: 10000 },
		)
		.toBe(200);
});

test.afterAll(async () => {
	if (child && child.exitCode === null) {
		const exited = new Promise<void>((done) =>
			child.once("exit", () => done()),
		);
		child.kill();
		await exited;
	}
});

test("real scratch service bootstraps browser session and persists synthetic result", async ({
	page,
}) => {
	const requests: string[] = [];
	const errors: string[] = [];
	page.on("request", (request) => {
		if (request.url().startsWith(service)) requests.push(request.url());
	});
	page.on("pageerror", (error) => errors.push(error.message));

	await page.goto("/?integrated");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Executar ensaio sintético" }).click();
	await expect(
		page.getByText("Concluído localmente", { exact: true }),
	).toBeVisible({ timeout: 12000 });
	await page.getByRole("button", { name: "Consultar resultado local" }).click();
	await expect(
		page.getByText("Nenhum recibo cloud recebido.", { exact: false }),
	).toBeVisible();
	await expect(
		page.locator("dd").filter({ hasText: "synthetic-session" }),
	).toBeVisible();

	// A new browser page receives a new origin-bound session but sees the same
	// persistent local queue/result from the scratch Agent.
	await page.reload();
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await expect(
		page.getByText("Concluído localmente", { exact: true }),
	).toBeVisible();
	expect(requests.some((url) => url.endsWith("/session"))).toBe(true);
	expect(requests.every((url) => url.startsWith(service))).toBe(true);
	expect(errors).toEqual([]);
});

test("HTTPS origin uses ephemeral browser session and hostile origin is denied", async ({
	browser,
}) => {
	const context = await browser.newContext();
	try {
		await context.grantPermissions(["local-network-access"], {
			origin: "https://tda-ui.test",
		});
		const page = await context.newPage();
		await page.route("https://tda-ui.test/", (route) =>
			route.fulfill({
				contentType: "text/html",
				body: "<!doctype html><title>Synthetic HTTPS bridge test</title><h1>Synthetic HTTPS bridge test</h1>",
			}),
		);
		await page.goto("https://tda-ui.test/");
		expect(await page.evaluate(() => isSecureContext)).toBe(true);
		const outcome = await page.evaluate(async (serviceUrl) => {
			const health = await fetch(serviceUrl + "/health", { credentials: "omit" });
			const denied = await fetch(serviceUrl + "/capabilities", { credentials: "omit" });
			const session = await fetch(serviceUrl + "/session", {
				method: "POST",
				credentials: "omit",
				headers: { "Content-Type": "application/json" },
				body: "{}",
			});
			const sessionBody = await session.json();
			const token = String(sessionBody.token || "");
			const capabilities = await fetch(serviceUrl + "/capabilities", {
				credentials: "omit",
				headers: { Authorization: "Bearer " + token },
			});
			const mutation = await fetch(serviceUrl + "/lifecycle", {
				method: "POST",
				credentials: "omit",
				headers: {
					Authorization: "Bearer " + token,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ action: "pause" }),
			});
			return {
				statuses: [
					health.status,
					denied.status,
					session.status,
					capabilities.status,
					mutation.status,
				],
				tokenLength: token.length,
			};
		}, service);
		expect(outcome.statuses).toEqual([200, 401, 200, 200, 200]);
		expect(outcome.tokenLength).toBeGreaterThanOrEqual(32);

		await page.route("https://hostile-ui.test/", (route) =>
			route.fulfill({
				contentType: "text/html",
				body: "<!doctype html><title>Synthetic denied origin</title>",
			}),
		);
		await context.grantPermissions(["local-network-access"], {
			origin: "https://hostile-ui.test",
		});
		await page.goto("https://hostile-ui.test/");
		const blocked = await page.evaluate(async (serviceUrl) => {
			try {
				const response = await fetch(serviceUrl + "/session", {
					method: "POST",
					credentials: "omit",
					headers: { "Content-Type": "application/json" },
					body: "{}",
				});
				return response.status === 403;
			} catch {
				return true;
			}
		}, service);
		expect(blocked).toBe(true);
	} finally {
		await context.close();
	}
});
