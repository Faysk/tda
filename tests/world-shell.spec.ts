import { expect, test } from "@playwright/test";

test("world surfaces share the desktop contextual universe navigation", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 1000 });
	await page.goto("/mundo");
	await expect(
		page.getByRole("navigation", { name: "Explorar o universo da campanha" }).first(),
	).toBeVisible();
	await expect(page.getByRole("link", { name: /Ecos da Jornada/ }).first()).toHaveAttribute(
		"aria-current",
		"page",
	);

	await page.getByRole("link", { name: /Personagens/ }).first().click();
	await expect(page).toHaveURL(/\/personagens$/);
	await expect(page.getByRole("heading", { level: 1, name: "Personagens" })).toBeVisible();
	await expect(page.getByRole("link", { name: /Personagens/ }).first()).toHaveAttribute(
		"aria-current",
		"page",
	);
});

test("universe navigation becomes a modal drawer at the 320px minimum", async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 800 });
	await page.goto("/mundo");
	await expect(page.getByRole("button", { name: "Explorar universo" })).toBeVisible();
	await page.getByRole("button", { name: "Explorar universo" }).click();
	await expect(
		page.getByRole("dialog", { name: "Navegação do universo da campanha" }),
	).toBeVisible();
	await page.getByRole("link", { name: /Lugares/ }).last().click();
	await expect(page).toHaveURL(/\/lugares$/);
	await expect(page.getByRole("heading", { level: 1, name: "Lugares" })).toBeVisible();
	expect(
		await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
	).toBeTruthy();
});

test("lore indexes use the central public metadata contract", async ({ page }) => {
	await page.goto("/personagens");
	await expect(page).toHaveTitle(/Personagens/);
	await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
		"content",
		"Personagens",
	);
	await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
		"content",
		"https://dnd.faysk.dev/personagens",
	);
	await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
		"content",
		"https://dnd.faysk.dev/og/default",
	);
	await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
		"href",
		"https://dnd.faysk.dev/personagens",
	);
});
