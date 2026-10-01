import { expect, test } from "@playwright/test";

test("relation authoring stays unavailable in the public World", async ({ page }) => {
	await page.goto("/campanhas/cronicas-da-mesa/mundo");
	await page.getByRole("button", { name: "Recolher painel de detalhes" }).click();

	const canvas = page.getByTestId("world-canvas");
	await expect(canvas).toBeVisible();
	await expect(canvas).toHaveAttribute("data-world-connection-active", "false");

	const firstNode = page.locator("[data-world-node]").first();
	await firstNode.click();
	await expect(page.getByRole("button", { name: "Conectar" })).toBeHidden();
	await expect(page.getByText("Conectar elementos")).toHaveCount(0);
});
