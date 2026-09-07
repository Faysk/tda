import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { expect, test } from "@playwright/test";

const token = "synthetic_integration_token_12345678901234567890";
const service = "http://127.0.0.1:18765/api/v1";
const uiOrigin = "http://127.0.0.1:3102";
let child: ChildProcess;
test.beforeAll(async () => {
	const python = process.env.TDA_COMPANION_PYTHON;
	const packageRoot = process.env.TDA_COMPANION_PACKAGE;
	if (!python || !packageRoot)
		throw new Error(
			"Set TDA_COMPANION_PYTHON and TDA_COMPANION_PACKAGE to the isolated Motorzinho test runtime/package. No installer or fallback is run.",
		);
	try {
		await fetch(`${service}/health`, { signal: AbortSignal.timeout(500) });
		throw new Error("TEST_PORT_IN_USE: refusing to reuse another service");
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("TEST_PORT"))
			throw error;
	}
	await mkdir("test-results", { recursive: true });
	const scratch = await mkdtemp(resolve("test-results/companion-"));
	const tokenPath = join(scratch, "synthetic-token.txt");
	await writeFile(tokenPath, token);
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
					return (await fetch(`${service}/health`)).status;
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

test("real scratch service: browser pairing to persistent synthetic job and local result", async ({
	page,
}) => {
	const requests: string[] = [];
	const errors: string[] = [];
	page.on("request", (request) => {
		if (request.method() === "POST") requests.push(request.url());
	});
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/?integrated");
	await page.getByLabel("Token de pareamento").fill(token);
	await page.getByRole("button", { name: "Conectar neste computador" }).click();
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
	await page.getByRole("button", { name: "Desconectar esta aba" }).click();
	await page.getByLabel("Token de pareamento").fill(token);
	await page.getByRole("button", { name: "Conectar neste computador" }).click();
	await expect(
		page.getByText("Concluído localmente", { exact: true }),
	).toBeVisible();
	expect(requests.length).toBeGreaterThan(0);
	expect(requests.every((url) => url.startsWith(service))).toBe(true);
	expect(errors).toEqual([]);
	await page.screenshot({
		path: test.info().outputPath("integrated.png"),
		fullPage: true,
	});
});

test("HTTPS browser context uses real loopback CORS, rejects unpaired and hostile origins", async ({
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
		const outcome = await page.evaluate(
			async ({ service, token }) => {
				const health = await fetch(`${service}/health`, {
					credentials: "omit",
				});
				const denied = await fetch(`${service}/capabilities`, {
					credentials: "omit",
				});
				const capabilities = await fetch(`${service}/capabilities`, {
					credentials: "omit",
					headers: { Authorization: `Bearer ${token}` },
				});
				const mutation = await fetch(`${service}/lifecycle`, {
					method: "POST",
					credentials: "omit",
					headers: {
						Authorization: `Bearer ${token}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ action: "pause" }),
				});
				return [
					health.status,
					denied.status,
					capabilities.status,
					mutation.status,
				];
			},
			{ service, token },
		);
		expect(outcome).toEqual([200, 401, 200, 200]);
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
		const blocked = await page.evaluate(
			async ({ service, token }) => {
				try {
					await fetch(`${service}/jobs`, {
						headers: { Authorization: `Bearer ${token}` },
					});
					return false;
				} catch {
					return true;
				}
			},
			{ service, token },
		);
		expect(blocked).toBe(true);
	} finally {
		await context.close();
	}
});
