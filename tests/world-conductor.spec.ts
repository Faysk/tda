import { expect, test } from "@playwright/test";

test("World Conductor stays out of the public workspace without edit capability", async ({ page }) => {
	await page.goto("/mundo");

	await expect(page.getByTestId("world-canvas")).toBeVisible();
	await expect(page.getByTestId("world-conductor")).toHaveCount(0);
	await expect(page.getByRole("region", { name: "Condução do Mundo" })).toHaveCount(0);
	await expect(page.getByRole("button", { name: /Conduzir/ })).toHaveCount(0);
});

test("World Conductor does not leak into a public focused projection", async ({ page }) => {
	await page.goto("/mundo?foco=astel");

	await expect(page.getByText("Foco exploratório atual.")).toBeVisible();
	await expect(page.getByTestId("world-conductor")).toHaveCount(0);
	await expect(page.getByRole("button", { name: /Conduzir/ })).toHaveCount(0);
});
