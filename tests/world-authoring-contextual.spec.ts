import { expect, test } from "@playwright/test";

test("contextual authoring actions stay out of the public World", async ({ page }) => {
	await page.goto("/campanhas/cronicas-da-mesa/mundo");
	await page.getByRole("button", { name: "Recolher painel de detalhes" }).click();
	await page.locator('[data-world-node="dandelion"]').click();

	await expect(page.locator("[data-world-node-toolbar]")).toBeHidden();
	await expect(
		page.getByRole("heading", { level: 2, name: "Dandelion", exact: true }),
	).toBeVisible();
});
