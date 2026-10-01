import { expect, test } from "@playwright/test";

test("curated lore catalogue discovers every listed experience exactly once", async ({
	page,
}) => {
	await page.goto("/lore");

	for (const slug of ["astel", "noah", "pipipi", "seika", "d", "yllith"] as const) {
		const card = page.locator(`article[data-lore="${slug}"]`);
		await expect(card).toHaveCount(1);
		await expect(card.getByRole("link")).toHaveAttribute("href", `/lore/${slug}`);
	}

});

test("Seika remains canonical while becoming discoverable from the catalogue", async ({
	page,
}) => {
	await page.goto("/lore");
	await page.locator('article[data-lore="seika"]').getByRole("link").click();
	await expect(page).toHaveURL(/\/lore\/seika$/u);
	await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
		"href",
		"https://dnd.faysk.dev/lore/seika",
	);
	await expect(page.locator("h1").first()).toHaveText("SEIKA");
});

test("catalogue preserves narrow-screen flow with the additional curated lore", async ({
	page,
}) => {
	await page.setViewportSize({ width: 320, height: 800 });
	await page.goto("/lore");
	await expect(page.locator('article[data-lore="seika"]')).toBeVisible();
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
	);
	expect(overflow).toBeLessThanOrEqual(1);
});
