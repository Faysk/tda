import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";

const service = "http://127.0.0.1:18765/api/v1";
const uiOrigin = "http://127.0.0.1:3102";
const secureOrigin = "https://tda-ui.test";
const masterToken = "synthetic_integration_token_12345678901234567890";

let child: ChildProcess | null = null;
let scratch = "";
let tokenPath = "";
let python = "";
let packageRoot = "";

async function assertPortFree() {
	try {
		await fetch(`${service}/health`, { signal: AbortSignal.timeout(500) });
		throw new Error("TEST_PORT_IN_USE: refusing to reuse another service");
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("TEST_PORT"))
			throw error;
	}
}

async function startService() {
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
			secureOrigin,
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
}

async function stopService() {
	const current = child;
	child = null;
	if (!current || current.exitCode !== null) return;
	const exited = new Promise<void>((done) =>
		current.once("exit", () => done()),
	);
	current.kill();
	await exited;
}

test.beforeAll(async () => {
	const configuredPython = process.env.TDA_COMPANION_PYTHON ?? "";
	const configuredPackageRoot = process.env.TDA_COMPANION_PACKAGE ?? "";
	if (!configuredPython || !configuredPackageRoot) {
		throw new Error(
			"Set TDA_COMPANION_PYTHON and TDA_COMPANION_PACKAGE to the isolated Companion test runtime/package. No installer or fallback is run.",
		);
	}
	// spawn() below deliberately runs with cwd=packageRoot. Resolve both inputs
	// while still at the repository root so a relative venv path cannot become
	// local-companion/.venv/... by accident on CI or a developer machine.
	python = resolve(configuredPython);
	packageRoot = resolve(configuredPackageRoot);
	await assertPortFree();
	await mkdir("test-results", { recursive: true });
	scratch = await mkdtemp(resolve("test-results/companion-"));
	tokenPath = join(scratch, "synthetic-token.txt");
	await writeFile(tokenPath, masterToken);
	await startService();
});

test.afterAll(async () => {
	await stopService();
});

test("real scratch Companion: automatic session, persistent job, restart and session renewal", async ({
	page,
}) => {
	const posts: string[] = [];
	page.on("request", (request) => {
		if (request.method() === "POST") posts.push(request.url());
	});
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));

	await page.goto("/?integrated");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await expect(page.getByLabel("Token de pareamento")).toHaveCount(0);
	expect(posts.some((url) => url === `${service}/session`)).toBe(true);

	await page.getByRole("tab", { name: "Diagnóstico" }).click();
	await page.getByRole("button", { name: "Executar ensaio sintético" }).click();

	await page.getByRole("tab", { name: "Fila" }).click();
	await expect(
		page.getByText("Concluído", { exact: true }).first(),
	).toBeVisible({ timeout: 12000 });
	await page.getByRole("button", { name: "Consultar resultado local" }).click();

	await page.getByRole("tab", { name: "Resultados" }).click();
	await expect(page.getByText("Resultado local", { exact: true })).toBeVisible();
	await expect(
		page.locator("dd").filter({ hasText: "synthetic-session" }),
	).toBeVisible();

	const sessionsBeforeRestart = posts.filter(
		(url) => url === `${service}/session`,
	).length;
	expect(sessionsBeforeRestart).toBeGreaterThanOrEqual(1);

	await stopService();
	await startService();

	// The in-memory browser credential died with the Agent. A normal refresh must
	// observe 401, bootstrap a new origin-bound session and replay the read.
	await page.getByRole("button", { name: "Atualizar estado" }).click();
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await expect(
		page.getByText("Concluído", { exact: true }).first(),
	).toBeVisible();
	await expect
		.poll(
			() =>
				posts.filter((url) => url === `${service}/session`).length,
		)
		.toBeGreaterThan(sessionsBeforeRestart);

	expect(
		await page.evaluate(
			() =>
				`${JSON.stringify(localStorage)} ${JSON.stringify(sessionStorage)} ${document.cookie}`,
		),
	).not.toContain("synthetic_integration_token");
	expect(errors).toEqual([]);
	await page.screenshot({
		path: test.info().outputPath("integrated-restart.png"),
		fullPage: true,
	});
});

test("HTTPS context gets an origin-bound browser session and hostile origin stays blocked", async ({
	browser,
}) => {
	const context = await browser.newContext();
	try {
		await context.grantPermissions(["local-network-access"], {
			origin: secureOrigin,
		});
		const page = await context.newPage();
		await page.route(`${secureOrigin}/`, (route) =>
			route.fulfill({
				contentType: "text/html",
				body: "<!doctype html><title>Synthetic HTTPS bridge test</title><h1>Synthetic HTTPS bridge test</h1>",
			}),
		);
		await page.goto(`${secureOrigin}/`);
		expect(await page.evaluate(() => isSecureContext)).toBe(true);

		const outcome = await page.evaluate(
			async ({ service }) => {
				const health = await fetch(`${service}/health`, {
					credentials: "omit",
				});
				const session = await fetch(`${service}/session`, {
					method: "POST",
					credentials: "omit",
					headers: { "Content-Type": "application/json" },
					body: "{}",
				});
				const sessionValue = (await session.json()) as {
					token: string;
					schema: string;
				};
				const capabilities = await fetch(`${service}/capabilities`, {
					credentials: "omit",
					headers: {
						Authorization: `Bearer ${sessionValue.token}`,
					},
				});
				const deniedMasterless = await fetch(`${service}/logs`, {
					credentials: "omit",
					headers: {
						Authorization: `Bearer ${sessionValue.token}`,
					},
				});
				return {
					health: health.status,
					session: session.status,
					schema: sessionValue.schema,
					capabilities: capabilities.status,
					adminScope: deniedMasterless.status,
					tokenLength: sessionValue.token.length,
				};
			},
			{ service },
		);
		expect(outcome).toMatchObject({
			health: 200,
			session: 200,
			schema: "tda_loopback_session_v1",
			capabilities: 200,
			adminScope: 403,
		});
		expect(outcome.tokenLength).toBeGreaterThanOrEqual(32);

		const hostileOrigin = "https://hostile-ui.test";
		await page.route(`${hostileOrigin}/`, (route) =>
			route.fulfill({
				contentType: "text/html",
				body: "<!doctype html><title>Synthetic denied origin</title>",
			}),
		);
		await context.grantPermissions(["local-network-access"], {
			origin: hostileOrigin,
		});
		await page.goto(`${hostileOrigin}/`);
		const blocked = await page.evaluate(async ({ service }) => {
			try {
				await fetch(`${service}/session`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: "{}",
				});
				return false;
			} catch {
				return true;
			}
		}, { service });
		expect(blocked).toBe(true);
	} finally {
		await context.close();
	}
});
