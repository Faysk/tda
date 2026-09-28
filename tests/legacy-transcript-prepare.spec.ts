import { expect, test, type Page } from "@playwright/test";

async function openAndConfirmPreparation(page: Page) {
	await page.getByRole("button", { name: "Preparar para edição" }).click();
	const dialog = page.getByRole("dialog", { name: "Confirmar preparação" });
	await expect(dialog).toBeVisible();
	await dialog.getByRole("button", { name: "Preparar para edição" }).click();
}

test("legacy preparation is explicit, cancellable and reuses the operation id after a lost response", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1920, height: 1080 });
	await page.goto("/e2e-fixtures/legacy-transcript-prepare");

	await expect(
		page.getByRole("heading", { name: "Prepare esta transcrição para edição" }),
	).toBeVisible();
	await expect(page.getByText("Sessão Legada Sintética", { exact: true })).toBeVisible();
	await expect(page.getByText("não será alterado", { exact: true })).toBeVisible();
	await expect(page.locator("body")).not.toContainText("handoff moderno");

	const prepare = page.getByRole("button", { name: "Preparar para edição" });
	await prepare.focus();
	await expect(prepare).toBeFocused();
	await prepare.click();

	const dialog = page.getByRole("dialog", { name: "Confirmar preparação" });
	await expect(dialog).toContainText("Nenhuma fala ou timestamp será corrigido automaticamente");
	await dialog.getByRole("button", { name: "Cancelar" }).click();
	await expect(dialog).toHaveCount(0);

	await page.getByRole("button", { name: "Perder próxima resposta" }).click();
	await openAndConfirmPreparation(page);
	await expect(page.getByRole("alert")).toContainText(
		"A mesma tentativa será reutilizada no próximo retry",
	);

	const firstAttempt = await page.getByTestId("legacy-attempt-ids").innerText();
	expect(firstAttempt).toMatch(
		/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
	);

	await openAndConfirmPreparation(page);
	await expect(page.getByRole("region", { name: "Editor moderno disponível" })).toBeVisible();
	await expect(page.getByRole("heading", { name: "Editor moderno disponível" })).toBeVisible();
	await expect(page.getByText(/sessão pública permanece inalterada/u)).toBeVisible();

	const attempts = (await page.getByTestId("legacy-attempt-ids").innerText()).split("|");
	expect(attempts).toHaveLength(2);
	expect(attempts[1]).toBe(attempts[0]);
});

test("stale legacy snapshot fails closed and never exposes the modern editor", async ({
	page,
}) => {
	await page.goto("/e2e-fixtures/legacy-transcript-prepare");
	await page.getByRole("button", { name: "Resposta stale" }).click();
	await openAndConfirmPreparation(page);

	await expect(page.getByRole("alert")).toContainText(
		"A transcrição mudou desde que esta página foi aberta",
	);
	await expect(page.getByRole("alert")).toContainText("nada foi gravado");
	await expect(page.getByRole("region", { name: "Editor moderno disponível" })).toHaveCount(0);
	expect((await page.getByTestId("legacy-attempt-ids").innerText()).split("|")).toHaveLength(1);
});

test("legacy preparation remains usable at 390px without horizontal overflow", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/e2e-fixtures/legacy-transcript-prepare");

	const prepare = page.getByRole("button", { name: "Preparar para edição" });
	await expect(prepare).toBeVisible();
	await prepare.focus();
	await expect(prepare).toBeFocused();
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth + 1,
		),
	).toBeTruthy();

	await prepare.click();
	const dialog = page.getByRole("dialog", { name: "Confirmar preparação" });
	await expect(dialog).toBeVisible();
	const box = await dialog.boundingBox();
	expect(box).not.toBeNull();
	if (box) {
		expect(box.x).toBeGreaterThanOrEqual(-1);
		expect(box.x + box.width).toBeLessThanOrEqual(391);
	}
});
