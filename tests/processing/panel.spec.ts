import { expect, test } from "@playwright/test";
import {
	failedJob,
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

test("API incompatível, versão antiga, offline e Origin negada são diagnósticos distintos", async ({
	page,
}) => {
	const requests: { url: string; authorization?: string }[] = [];
	await page.route(`${LOCAL_API}/**`, async (route) => {
		requests.push({
			url: route.request().url(),
			authorization: route.request().headers().authorization,
		});
		return fulfillJson(route, {
			api_version: "2",
			service_version: "0.3.99",
			lifecycle: "ready",
		});
	});
	await page.goto("/");
	await expect(page.getByText("API incompatível", { exact: true })).toBeVisible();
	await expect(page.getByRole("alert")).toContainText("API v2");
	expect(requests).toHaveLength(1);
	expect(requests[0]?.authorization).toBeUndefined();

	await page.unroute(`${LOCAL_API}/**`);
	await page.route(`${LOCAL_API}/**`, (route) =>
		fulfillJson(route, {
			api_version: "1",
			service_version: "0.3.13",
			lifecycle: "ready",
		}),
	);
	await page.getByRole("button", { name: "Tentar novamente" }).click();
	await expect(
		page.getByText("Atualização necessária", { exact: true }),
	).toBeVisible();
	await expect(page.getByRole("alert")).toContainText("v0.3.13");
	await expect(page.getByRole("alert")).toContainText("v0.3.14");

	await page.unroute(`${LOCAL_API}/**`);
	await page.route(`${LOCAL_API}/**`, (route) => route.abort("failed"));
	await page.getByRole("button", { name: "Tentar novamente" }).click();
	await expect(page.getByRole("alert")).toContainText(
		"permissão de acesso à rede local",
	);
	await expect(page.getByRole("alert")).toContainText("Código: unreachable");

	await page.unroute(`${LOCAL_API}/**`);
	await page.route(`${LOCAL_API}/**`, async (route) => {
		const path = new URL(route.request().url()).pathname;
		if (path.endsWith("/health")) {
			return fulfillJson(route, {
				api_version: "1",
				service_version: "0.3.14",
				lifecycle: "ready",
			});
		}
		return fulfillJson(
			route,
			{ error: { code: "ORIGIN_REJECTED", recoverable: false } },
			403,
		);
	});
	await page.getByRole("button", { name: "Tentar novamente" }).click();
	await expect(page.getByRole("alert")).toContainText("ORIGIN_REJECTED");
});

test("sessão browser expirada é renovada automaticamente", async ({ page }) => {
	const state = await installCompanionFixture(page, {
		profileReady: true,
		expireBrowserSessionOnce: true,
	});

	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	expect(state.sessionCount).toBeGreaterThanOrEqual(2);
	expect(
		state.requests.filter((request) => request.path === "/session").length,
	).toBeGreaterThanOrEqual(2);
	expect(
		await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
	).toBe(true);
});

test("cancelamento exige confirmação e converge para cancelled", async ({ page }) => {
	const state = await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: [fixtureJob("running")],
	});

	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await expect(page.getByText("Processando", { exact: true }).first()).toBeVisible();

	await page.getByRole("button", { name: "Cancelar trabalho" }).first().click();
	await expect(page.getByRole("dialog")).toContainText("craig-job-1");
	expect(
		state.requests.filter((request) => request.path.endsWith("/cancel")),
	).toHaveLength(0);
	await page.getByRole("button", { name: "Confirmar", exact: true }).click();

	await expect
		.poll(() => state.job?.status)
		.toBe("cancelled");
	await page.getByRole("tab", { name: "Fila" }).click();
	await expect(
		page.getByRole("listitem").getByText("Cancelado", { exact: true }),
	).toBeVisible();
});

test("ações locais e refresh não emitem loading global dentro da workspace", async ({ page }) => {
	const state = await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: [fixtureJob("running")],
		jobReadDelayMs: 800,
	});
	await page.addInitScript(() => {
		const starts: string[] = [];
		(window as Window & { __globalLoadingStarts?: string[] }).__globalLoadingStarts = starts;
		window.addEventListener("tda:global-loading-start", (event) => {
			const detail = (event as CustomEvent<{ id?: string }>).detail;
			starts.push(detail?.id ?? "unknown");
		});
	});

	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();

	await page.getByRole("button", { name: "Atualizar estado" }).click();
	await expect(page.getByRole("button", { name: "Atualizando…" })).toBeVisible();

	await page.getByRole("button", { name: "Cancelar trabalho" }).first().click();
	await page.getByRole("button", { name: "Confirmar", exact: true }).click();

	await expect.poll(() => state.job?.status).toBe("cancelled");
	expect(
		await page.evaluate(
			() =>
				(window as Window & { __globalLoadingStarts?: string[] })
					.__globalLoadingStarts ?? [],
		),
	).toEqual([]);
});

test("refresh atrasado mantém ação do job clicável e não regride o estado novo", async ({ page }) => {
	const state = await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: [fixtureJob("running")],
		jobReadDelayMs: 800,
	});

	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();

	const refresh = page.getByRole("button", { name: "Atualizar estado" });
	const cancel = page.getByRole("button", { name: "Cancelar trabalho" }).first();
	await refresh.click();
	await expect(page.getByRole("button", { name: "Atualizando…" })).toBeVisible();
	await expect(cancel).toBeEnabled();

	await cancel.click();
	await expect(page.getByRole("dialog")).toContainText("craig-job-1");
	await page.getByRole("button", { name: "Confirmar", exact: true }).click();

	await expect.poll(() => state.job?.status).toBe("cancelled");
	await page.getByRole("tab", { name: "Fila" }).click();
	await expect(
		page.getByRole("listitem").getByText("Cancelado", { exact: true }),
	).toBeVisible();
});

test("falha recuperável cria nova tentativa somente após confirmação", async ({ page }) => {
	const state = await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: [failedJob()],
		jobEvents: [
			{
				seq: 91,
				code: "QWEN_ALIGNMENT_WINDOW_FAILED",
				at: "2026-09-25T12:00:00Z",
				level: "error",
				data: {
					stage: "alignment",
					track: 1,
					window: 89,
					failure_class: "QWEN_ALIGNMENT_TIMESTAMP_OWNED_OVERFLOW",
				},
			},
		],
	});

	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "Fila" }).click();
	await page.getByRole("button", { name: "Ver diagnóstico" }).click();
	await expect(page.getByRole("tab", { name: "Diagnóstico" })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(
		page.getByRole("heading", { name: "Detalhes do processamento" }),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Histórico de eventos" }),
	).toBeVisible();
	await expect(page.getByText("1 mais recente", { exact: true })).toBeVisible();
	await expect(page.getByRole("log")).toContainText(
		"Falha de alinhamento Qwen · faixa 1 · janela 89.",
	);
	await expect(page.getByRole("log")).toContainText(
		"Uma palavra extrapolou a janela ainda dentro da região que esta janela precisa proteger.",
	);
	await page.getByRole("tab", { name: "Fila" }).click();
	await page.getByRole("button", { name: "Repetir trabalho" }).click();
	await expect(page.getByRole("dialog")).toContainText(
		"checkpoints compatíveis serão reutilizados quando disponíveis",
	);
	await page.getByRole("button", { name: "Confirmar", exact: true }).click();

	await expect
		.poll(() => state.job?.attempt)
		.toBe(2);
	expect(state.job?.status).toBe("queued");
	await expect(page.getByText("Na fila", { exact: true })).toBeVisible();
});

test("fila pausada continua distinta de falha e pode ser retomada", async ({ page }) => {
	const state = await installCompanionFixture(page, {
		profileReady: true,
		lifecycle: "paused",
		advanceJobs: false,
	});
	await page.goto("/");
	await expect(page.getByText("Fila pausada", { exact: true })).toBeVisible();

	await page.getByRole("button", { name: "Retomar fila" }).click();
	await expect(page.getByRole("dialog")).toContainText("iniciar os trabalhos");
	await page.getByRole("button", { name: "Confirmar", exact: true }).click();

	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	expect(
		state.requests.some(
			(request) =>
				request.path === "/lifecycle" && request.method === "POST",
		),
	).toBe(true);
});
