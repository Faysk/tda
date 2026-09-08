import { expect, test } from "@playwright/test";

test("World Explorer keeps the mobile inspector recoverable after desktop collapse", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto("/mundo");

	const collapse = page.getByRole("button", {
		name: "Recolher painel de detalhes",
	});
	await expect(collapse).toBeVisible();
	await collapse.click();
	await expect(
		page.getByRole("heading", { level: 2, name: "A campanha", exact: true }),
	).toHaveCount(0);

	await page.setViewportSize({ width: 390, height: 844 });
	const reopen = page.getByRole("button", {
		name: "Abrir painel de detalhes",
	});
	await expect(reopen).toBeVisible();

	const target = await reopen.boundingBox();
	expect(target).not.toBeNull();
	expect(target?.width ?? 0).toBeGreaterThanOrEqual(44);
	expect(target?.height ?? 0).toBeGreaterThanOrEqual(44);

	await reopen.click();
	await expect(
		page.getByRole("heading", { level: 2, name: "A campanha", exact: true }),
	).toBeVisible();
	expect(
		await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
	).toBeTruthy();
});
