import { expect, test, type Page } from "@playwright/test";
const token = "synthetic_test_token_12345678901234567890";
const origin = "http://127.0.0.1:8765/api/v1";
const running = {
	id: "synthetic-job",
	kind: "synthetic.fixture",
	status: "running",
	stage: "fixture",
	progress: { completed: 1, total: 3, unit: "items" },
	error: null,
	result_available: false,
	updated_at: "2026-09-07T12:00:00Z",
};
async function pair(page: Page) {
	await page.getByLabel("Token de pareamento").fill(token);
	await page.getByRole("button", { name: "Conectar neste computador" }).click();
}
test("pairing, real reported progress, contextual cancel and disconnect", async ({
	page,
}) => {
	let job = { ...running };
	const mutations: string[] = [];
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.route(`${origin}/**`, async (route) => {
		const path = new URL(route.request().url()).pathname;
		if (route.request().method() === "POST") {
			mutations.push(path);
			job = { ...job, status: "cancelled", stage: "cancelled" };
		}
		await route.fulfill({
			headers: { "Access-Control-Allow-Origin": "http://127.0.0.1:3102" },
			json: path.endsWith("/health")
				? { api_version: "1", service_version: "0.1.0", lifecycle: "ready" }
				: path.endsWith("/capabilities")
					? {
							capabilities: ["synthetic.fixture"],
							sync: false,
							device: { id: "test-device", label: "PC sintético" },
						}
					: path.endsWith("/jobs")
						? { jobs: [job] }
						: job,
		});
	});
	await page.goto("/");
	await expect(
		page.getByText("Serviço desconectado", { exact: true }),
	).toBeVisible();
	await pair(page);
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await expect(page.getByRole("progressbar")).toHaveAttribute("value", "1");
	await expect(page.getByRole("progressbar")).toHaveAttribute("max", "3");
	await page.getByRole("button", { name: "Cancelar trabalho" }).click();
	await expect(page.getByRole("dialog")).toContainText("synthetic-job");
	expect(mutations).toEqual([]);
	await page.getByRole("button", { name: "Voltar", exact: true }).click();
	expect(mutations).toEqual([]);
	await page.getByRole("button", { name: "Cancelar trabalho" }).click();
	await page.getByRole("button", { name: "Confirmar", exact: true }).click();
	await expect(page.locator("li .ds-status")).toHaveText("Cancelado");
	expect(mutations).toEqual(["/api/v1/jobs/synthetic-job/cancel"]);
	await expect(
		page.getByText("Sincronização não configurada.", { exact: true }),
	).toBeVisible();
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= innerWidth,
		),
	).toBe(true);
	await page.screenshot({
		path: test.info().outputPath("processing.png"),
		fullPage: true,
	});
	await page.getByRole("button", { name: "Desconectar esta aba" }).click();
	await expect(
		page.getByText("Serviço desconectado", { exact: true }),
	).toBeVisible();
	await expect(page.getByRole("progressbar")).toHaveCount(0);
	await expect(page.getByLabel("Token de pareamento")).toHaveValue("");
	expect(
		await page.evaluate(
			() =>
				`${JSON.stringify(localStorage)} ${JSON.stringify(sessionStorage)} ${document.cookie}`,
		),
	).not.toContain(token);
	expect(errors).toEqual([]);
});
test("mismatch blocks credentials and retry UI, network failure gives actionable diagnosis", async ({
	page,
}) => {
	const requests: string[] = [];
	await page.route(`${origin}/**`, async (route) => {
		requests.push(route.request().url());
		expect(route.request().headers().authorization).toBeUndefined();
		await route.fulfill({
			headers: { "Access-Control-Allow-Origin": "http://127.0.0.1:3102" },
			json: { api_version: "2" },
		});
	});
	await page.goto("/");
	await pair(page);
	await expect(
		page.getByText("Versão incompatível", { exact: true }),
	).toBeVisible();
	expect(requests).toHaveLength(1);
	await page.unroute(`${origin}/**`);
	await page.route(`${origin}/**`, (route) => route.abort("failed"));
	await pair(page);
	await expect(page.getByRole("alert")).toContainText("origem ou permissão");
});
test("preparation, paused queue and recoverable failure stay distinct", async ({
	page,
}) => {
	let lifecycle = "preparing";
	await page.route(`${origin}/**`, async (route) => {
		const path = new URL(route.request().url()).pathname;
		await route.fulfill({
			headers: { "Access-Control-Allow-Origin": "http://127.0.0.1:3102" },
			json: path.endsWith("/health")
				? { api_version: "1", service_version: "0.1.0", lifecycle }
				: path.endsWith("/capabilities")
					? {
							capabilities: ["synthetic.fixture"],
							sync: false,
							device: { id: "test-device", label: "PC sintético" },
						}
					: {
							jobs: [
								{
									...running,
									status: "interrupted",
									stage: "interrupted",
									progress: null,
									error: { code: "restart", recoverable: true },
								},
							],
						},
		});
	});
	await page.goto("/");
	await pair(page);
	await expect(page.getByText("Em preparação", { exact: true })).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Executar ensaio sintético" }),
	).toBeDisabled();
	await expect(
		page.getByText("Sem medida de progresso nesta etapa."),
	).toBeVisible();
	await page.getByRole("button", { name: "Repetir trabalho" }).click();
	await expect(page.getByRole("dialog")).toContainText(
		"não promete retomar do ponto exato",
	);
	await page.keyboard.press("Escape");
	lifecycle = "paused";
	await page.getByRole("button", { name: "Atualizar estado" }).click();
	await expect(page.getByText("Fila pausada", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Retomar fila" }).click();
	await expect(page.getByRole("dialog")).toContainText("iniciar os trabalhos");
});
