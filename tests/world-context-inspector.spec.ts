import { expect, test } from "@playwright/test";

test("World inspector presents authorized context without inventing unavailable lore", async ({ page }) => {
	await page.goto("/mundo");
	await page.locator('[data-world-node="dandelion"]').click();

	await expect(
		page.getByRole("heading", { level: 2, name: "Dandelion", exact: true }),
	).toBeVisible();
	const overview = page.locator('[data-inspector-tab="overview"]');
	await expect(overview.getByText("Contexto público", { exact: true })).toBeVisible();
	await expect(
		overview.getByText(/Este recorte não traz um resumo narrativo público/),
	).toBeVisible();
	await expect(overview.getByText("Relações visíveis", { exact: true })).toBeVisible();

	const entityMeta = page.getByRole("region", { name: "Entidade no mundo: Dandelion" });
	await expect(entityMeta).toBeVisible();
	await expect(entityMeta.getByText("Herói / personagem", { exact: true })).toBeVisible();
	await expect(entityMeta.getByText("Sem rota publicada", { exact: true })).toBeVisible();

	const astelRelation = overview
		.getByRole("button", { name: "Selecionar Astel; relação Amizade" })
		.first();
	await expect(astelRelation).toBeVisible();
	await astelRelation.click();
	await expect(
		page.getByRole("heading", { level: 2, name: "Astel", exact: true }),
	).toBeVisible();
	await expect(page).toHaveURL(/\/mundo$/);
});

test("World contextual inspector stays usable as the mobile sheet", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/mundo");
	await page.locator('[data-world-node="dandelion"]').click();

	const inspector = page.getByRole("complementary");
	await expect(inspector).toBeVisible();
	await expect(
		inspector.getByRole("heading", { level: 2, name: "Dandelion", exact: true }),
	).toBeVisible();

	const relationChip = inspector
		.getByRole("button", { name: "Selecionar Astel; relação Amizade" })
		.first();
	const chipBox = await relationChip.boundingBox();
	expect(chipBox).not.toBeNull();
	expect(chipBox?.height ?? 0).toBeGreaterThanOrEqual(40);

	expect(
		await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
	).toBeTruthy();
});
