import { expect, test } from "@playwright/test";

test("direct create controls stay out of the public World", async ({ page }) => {
	await page.goto("/mundo");

	await expect(page.getByTestId("world-canvas")).toBeVisible();
	await expect(page.getByRole("button", { name: "Novo elemento" })).toHaveCount(0);
	await page.keyboard.press("n");
	await expect(page.getByRole("dialog", { name: "Escolher tipo do novo elemento" })).toHaveCount(0);
	await expect(page.getByTestId("world-canvas")).toHaveAttribute(
		"data-world-placement-active",
		"false",
	);
});
