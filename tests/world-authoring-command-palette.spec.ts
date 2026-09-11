import { expect, test } from "@playwright/test";

test("command palette stays out of the public World", async ({ page }) => {
	await page.goto("/mundo");

	await expect(page.getByTestId("world-canvas")).toBeVisible();
	await expect(page.getByRole("button", { name: /Comandos do Mundo/i })).toHaveCount(0);
	await page.keyboard.press("Control+K");
	await expect(page.getByRole("dialog", { name: "Comandos do Mundo" })).toHaveCount(0);
	await expect(page.locator("[data-world-command-palette]")).toHaveCount(0);
});
