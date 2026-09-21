import { expect, test } from "@playwright/test";
import {
	installCompanionFixture,
	LOCAL_API,
	TRANSCRIPT_SHA,
} from "./companion-fixture";

async function selectCraig(page: import("@playwright/test").Page) {
	await page.getByLabel("ID da sessão").fill("sessao-42");
	await page.getByLabel("Export do Craig").setInputFiles({
		name: "sessao-42.zip",
		mimeType: "application/zip",
		buffer: Buffer.from("PK synthetic Craig fixture"),
	});
}

async function refresh(page: import("@playwright/test").Page) {
	const button = page.getByRole("button", { name: "Atualizar estado" });
	await expect(button).toBeEnabled();
	await button.click();
}

test("desktop controls stay compact and advanced fields expand on demand", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
	});
	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();

	const advanced = page.getByText("Opções avançadas", { exact: true });
	await expect(advanced).toBeVisible();
	await expect(page.getByLabel("Contexto opcional")).not.toBeVisible();
	await expect(page.getByLabel("Glossário opcional")).not.toBeVisible();

	await advanced.click();
	await expect(page.getByLabel("Contexto opcional")).toBeVisible();
	await expect(page.getByLabel("Glossário opcional")).toBeVisible();
	await advanced.click();

	const statusStrip = page.getByRole("region", {
		name: "Uso e fila do computador local",
	});
	await expect(statusStrip).toContainText("GPU");
	await expect(statusStrip).toContainText("CPU");
	await expect(statusStrip).toContainText("RAM");
	await expect(statusStrip).toContainText("Processando");
	await expect(statusStrip).toContainText("Na fila");
	await expect(statusStrip).toContainText("Concluídos");
	await expect(statusStrip).toContainText("Atenção");

	for (const locator of [
		page.getByText("Nova transcrição Craig", { exact: true }),
		page.getByText("Computador local", { exact: true }),
		page.getByText("Processando agora", { exact: true }),
		page.getByText("Detalhes do processamento", { exact: true }),
	]) {
		const box = await locator.boundingBox();
		expect(box).not.toBeNull();
		expect((box?.y ?? 9999) + (box?.height ?? 0)).toBeLessThanOrEqual(900);
	}

	expect(
		await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
	).toBe(true);
});

test("automatic session → Craig staging → preparation → queue → progress → result", async ({
	page,
}) => {
	const state = await installCompanionFixture(page, {
		profileReady: false,
		advanceJobs: true,
	});
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));

	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await expect(page.getByText("Nova transcrição Craig", { exact: true })).toBeVisible();

	const health = state.requests.find((request) => request.path === "/health");
	const session = state.requests.find((request) => request.path === "/session");
	expect(health?.authorization).toBeUndefined();
	expect(session?.authorization).toBeUndefined();
	expect(state.sessionCount).toBe(1);

	await selectCraig(page);
	await page.getByRole("button", { name: "Adicionar à fila local" }).click();

	await expect
		.poll(() => state.uploadCount)
		.toBe(1);
	await expect
		.poll(() => state.preparationPostCount)
		.toBe(1);
	await expect
		.poll(() => state.jobPostCount)
		.toBe(1);
	expect(state.idempotencyKeys).toHaveLength(1);
	expect(state.idempotencyKeys[0]).toMatch(/^[A-Za-z0-9_-]{1,128}$/);

	for (let index = 0; index < 4; index += 1) {
		await refresh(page);
		if (state.job?.status === "succeeded") break;
	}
	await expect
		.poll(() => state.job?.status)
		.toBe("succeeded");
	expect(state.jobStatusesServed).toContain("queued");
	expect(state.jobStatusesServed).toContain("running");
	expect(state.jobStatusesServed).toContain("succeeded");

	await expect(
		page.getByText("Concluído", { exact: true }).first(),
	).toBeVisible();
	await page.getByRole("button", { name: "Consultar resultado local" }).click();
	await expect(page.getByText("run-craig-job-1-a1", { exact: false })).toBeVisible();
	await expect(page.getByText(TRANSCRIPT_SHA.slice(0, 12), { exact: false })).toBeVisible();

	expect(
		state.requests.some(
			(request) =>
				request.path === "/sources/craig" &&
				request.authorization?.startsWith("Bearer "),
		),
	).toBe(true);
	expect(
		state.requests.some(
			(request) =>
				request.path === "/jobs" &&
				request.method === "POST" &&
				Boolean(request.idempotencyKey),
		),
	).toBe(true);
	expect(
		await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
	).toBe(true);
	expect(errors).toEqual([]);
});

test("ambiguous job response reuses the same idempotency key without re-uploading Craig", async ({
	page,
}) => {
	const state = await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		ambiguousJobPostOnce: true,
	});
	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await selectCraig(page);

	await page.getByRole("button", { name: "Adicionar à fila local" }).click();
	await expect(page.getByRole("alert")).toContainText(
		"Não foi possível alcançar o Companion local",
	);
	await expect(page.getByText(/tentativa ficou ambígua/i)).toBeVisible();

	await page.getByRole("button", { name: "Adicionar à fila local" }).click();
	await expect
		.poll(() => state.jobPostCount)
		.toBe(2);

	expect(state.uploadCount).toBe(1);
	expect(state.idempotencyKeys).toHaveLength(2);
	expect(state.idempotencyKeys[0]).toBe(state.idempotencyKeys[1]);
});

test("UTF-8 envelope budget blocks an accepted character count before upload", async ({
	page,
}) => {
	const state = await installCompanionFixture(page, { profileReady: true });
	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await selectCraig(page);
	await page.getByLabel("Contexto opcional").fill("😀".repeat(1200));

	await expect(page.getByRole("alert")).toContainText("bytes UTF-8");
	await expect(
		page.getByRole("button", { name: "Adicionar à fila local" }),
	).toBeDisabled();
	expect(state.uploadCount).toBe(0);
	expect(
		state.requests.filter(
			(request) => request.path === "/sources/craig",
		),
	).toHaveLength(0);
});

test("all authenticated local mutations use the browser session, never a master token", async ({
	page,
}) => {
	const state = await installCompanionFixture(page, { profileReady: true });
	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();

	const authenticated = state.requests.filter(
		(request) =>
			request.path !== "/health" &&
			request.path !== "/session" &&
			request.path.startsWith("/"),
	);
	expect(authenticated.length).toBeGreaterThan(0);
	expect(
		authenticated.every(
			(request) => request.authorization === `Bearer browser_session_fixture_123456789012345678901234567890`,
		),
	).toBe(true);
	expect(
		await page.evaluate(
			() =>
				`${JSON.stringify(localStorage)} ${JSON.stringify(sessionStorage)} ${document.cookie}`,
		),
	).not.toContain("browser_session_fixture");
	expect(
		state.requests.every((request) => request.path.startsWith("/")),
	).toBe(true);
	expect(LOCAL_API).toBe("http://127.0.0.1:8765/api/v1");
});
