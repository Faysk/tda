import { expect, test } from "@playwright/test";

test("World Explorer opens as a multi-hub overview and keeps selection separate from focus", async ({ page }) => {
	await page.goto("/mundo");
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ecos da Jornada");
	await expect(page.getByText("Demonstração · relações não canônicas")).toBeVisible();
	await expect(page.getByRole("heading", { level: 2, name: "A campanha", exact: true })).toBeVisible();

	await page.locator('[data-world-node="astel"]').click();
	await expect(page.getByRole("heading", { level: 2, name: "Astel", exact: true })).toBeVisible();
	await expect(page).toHaveURL(/\/mundo$/);

	await page.getByRole("link", { name: "Explorar conexões de Astel" }).click();
	await expect(page).toHaveURL(/\/mundo\?foco=astel$/);
	await expect(page.getByText("Foco exploratório atual.")).toBeVisible();
	await expect(page.locator('[data-world-node="raven-queen"]')).toBeVisible();
});

test("World Explorer inspector traverses visible connections without changing focus", async ({ page }) => {
	await page.goto("/mundo");
	await page.locator('[data-world-node="astel"]').click();

	await expect(page.getByRole("heading", { level: 3, name: "Conexões visíveis" })).toBeVisible();
	await expect(page.getByText("Vínculo místico", { exact: true }).first()).toBeVisible();
	await page.getByRole("button", { name: "Selecionar Raven Queen; relação Vínculo místico" }).click();

	await expect(page.getByRole("heading", { level: 2, name: "Raven Queen", exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Selecionar Astel; relação Vínculo místico" })).toBeVisible();
	await expect(page).toHaveURL(/\/mundo$/);
});

test("World Explorer exposes honest SSR metadata through the central public contract", async ({ page }) => {
	await page.goto("/mundo");
	await expect(page).toHaveTitle(/Ecos da Jornada — demonstração/);
	await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /Demonstração multi-hub.*não são canon/);
	await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", "https://dnd.faysk.dev/mundo");
	await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://dnd.faysk.dev/mundo");

	await page.goto("/mundo?foco=astel");
	await expect(page).toHaveTitle(/Astel · Ecos da Jornada — demonstração/);
	await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", "https://dnd.faysk.dev/mundo?foco=astel");

	await page.goto("/mundo?foco=segredo-inexistente");
	await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", "Ecos da Jornada — demonstração");
	await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://dnd.faysk.dev/mundo");
});

test("World Explorer can switch to the textual view and filter relations", async ({ page }) => {
	await page.goto("/mundo");
	await page.getByRole("button", { name: "Lista" }).click();
	const relations = page.locator('section[aria-labelledby="world-relations-title"]');
	await expect(relations.getByRole("heading", { name: "Relações em lista" })).toBeVisible();
	await expect(page.getByTestId("world-canvas")).toHaveCount(0);

	await page.getByLabel("Relação").selectOption("conflict");
	await expect(page.getByLabel("Relação")).toHaveValue("conflict");
	await expect(relations.getByText("Conflito", { exact: true })).toBeVisible();
	await expect(relations.getByText("Rivalidade", { exact: true })).toBeVisible();
});

test("World Explorer nodes are movable without changing the URL", async ({ page }) => {
	await page.goto("/mundo");
	const astel = page.locator('[data-world-node="astel"]').locator("..");
	const before = await astel.getAttribute("style");
	const box = await astel.boundingBox();
	if (box) {
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 30, { steps: 6 });
		await page.mouse.up();
	}
	const after = await astel.getAttribute("style");
	expect(after).not.toBe(before);
	await expect(page).toHaveURL(/\/mundo$/);
});

test("World Explorer stays inside the viewport including the 320px minimum", async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 800 });
	await page.goto("/mundo");
	await expect(page.getByTestId("world-canvas")).toBeVisible();
	await expect(page.getByRole("button", { name: "Todos" })).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});
