import { expect, test } from "@playwright/test";

test("World Explorer keeps selection separate from focus", async ({ page }) => {
	await page.goto("/mundo");
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ecos da Jornada");
	await expect(page.getByText("Demonstração · relações não canônicas")).toBeVisible();
	await expect(page.getByText("Entidade focal atual.")).toBeVisible();

	await page.locator('[data-world-node="astel"]').click();
	await expect(page.getByRole("heading", { level: 2, name: "Astel" })).toBeVisible();
	await expect(page).toHaveURL(/\/mundo$/);

	await page.getByRole("link", { name: "Explorar conexões de Astel" }).click();
	await expect(page).toHaveURL(/\/mundo\?foco=astel$/);
	await expect(page.getByText("Entidade focal atual.")).toBeVisible();
	await expect(page.locator('[data-world-node="raven-queen"]')).toBeVisible();
});

test("World Explorer exposes honest SSR metadata for shareable demo focus", async ({
	page,
}) => {
	await page.goto("/mundo");
	await expect(page).toHaveTitle(/Ecos da Jornada — demonstração/);
	await expect(page.locator('meta[name="description"]')).toHaveAttribute(
		"content",
		/Demonstração do World Explorer do TDA.*não são canon/,
	);
	await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
		"content",
		"Ecos da Jornada — demonstração",
	);
	await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
		"href",
		/\/mundo$/,
	);

	await page.goto("/mundo?foco=astel");
	await expect(page).toHaveTitle(/Astel · Ecos da Jornada — demonstração/);
	await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
		"content",
		"Astel · Ecos da Jornada — demonstração",
	);
	await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
		"href",
		/\/mundo\?foco=astel$/,
	);

	await page.goto("/mundo?foco=segredo-inexistente");
	await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
		"content",
		"Ecos da Jornada — demonstração",
	);
	await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
		"href",
		/\/mundo$/,
	);
});

test("World Explorer filters without losing its textual alternative", async ({ page }) => {
	await page.goto("/mundo");
	await page.getByRole("button", { name: "Lugares" }).click();
	await expect(page.locator('[data-world-node="reino-fadas"]')).toBeVisible();
	await expect(page.locator('[data-world-node="astel"]')).toHaveCount(0);
	await expect(page.getByRole("heading", { name: "Relações em lista" })).toBeVisible();
	await expect(page.getByRole("button", { name: /Reino das Fadas/ })).toBeVisible();
});

test("World Explorer stays inside the viewport on configured devices", async ({ page }) => {
	await page.goto("/mundo");
	await expect(page.getByTestId("world-canvas")).toBeVisible();
	expect(
		await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
	).toBeTruthy();
});

test("World Explorer remains usable at the 320px minimum", async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 800 });
	await page.goto("/mundo");
	await expect(page.getByTestId("world-canvas")).toBeVisible();
	await expect(page.getByRole("button", { name: "Todos" })).toBeVisible();
	await expect(page.getByRole("heading", { name: "Relações em lista" })).toBeVisible();
	expect(
		await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
	).toBeTruthy();
});
