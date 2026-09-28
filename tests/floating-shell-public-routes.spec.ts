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

		const [brandBox, triggerBox] = await Promise.all([
			page.locator(".brand").boundingBox(),
			page.locator(".account-menu-trigger").boundingBox(),
		]);

		const target =
			route === "/lembra"
				? page.getByPlaceholder("Buscar título, descrição, autor ou data...")
				: page.getByRole("heading", { level: 1 }).first();
		await expect(target).toBeVisible();
		const box = await target.boundingBox();
		expect(box).not.toBeNull();
		expect(brandBox).not.toBeNull();
		expect(triggerBox).not.toBeNull();
		if (box && brandBox && triggerBox) {
			const overlaps = (
				left: typeof box,
				right: typeof box,
			) =>
				left.x < right.x + right.width &&
				left.x + left.width > right.x &&
				left.y < right.y + right.height &&
				left.y + left.height > right.y;
			expect(overlaps(box, brandBox)).toBeFalsy();
			expect(overlaps(box, triggerBox)).toBeFalsy();
		}

		const overflow = await page.evaluate(() => ({
			scrollWidth: document.documentElement.scrollWidth,
			clientWidth: document.documentElement.clientWidth,
		}));
		expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
	}
});
