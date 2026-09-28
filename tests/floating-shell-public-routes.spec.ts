import { expect, test } from "@playwright/test";

test("floating chrome leaves first critical public content reachable on narrow viewports", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });

	for (const route of [
		"/sessoes",
		"/lore",
		"/personagens",
		"/npcs",
		"/lugares",
		"/faccoes",
		"/quests",
		"/musicas",
		"/diario",
		"/lembra",
	]) {
		await page.goto(route);

		const chromeBottom = await page.evaluate(() => {
			const brand = document.querySelector<HTMLElement>(".brand")?.getBoundingClientRect();
			const trigger = document
				.querySelector<HTMLElement>(".account-menu-trigger")
				?.getBoundingClientRect();
			return Math.max(brand?.bottom ?? 0, trigger?.bottom ?? 0);
		});

		const target =
			route === "/lembra"
				? page.getByPlaceholder("Buscar título, descrição, autor ou data...")
				: page.getByRole("heading", { level: 1 }).first();
		await expect(target).toBeVisible();
		const box = await target.boundingBox();
		expect(box).not.toBeNull();
		if (box) expect(box.y + box.height).toBeGreaterThan(chromeBottom + 4);

		const overflow = await page.evaluate(() => ({
			scrollWidth: document.documentElement.scrollWidth,
			clientWidth: document.documentElement.clientWidth,
		}));
		expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
	}
});
