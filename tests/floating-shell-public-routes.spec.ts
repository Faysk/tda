import { expect, test } from "playwright/test";

const publicRoutes = [
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
] as const;

async function expectFirstCriticalContentClear(
	page: import("@playwright/test").Page,
	route: (typeof publicRoutes)[number],
) {
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
			left: { x: number; y: number; width: number; height: number },
			right: { x: number; y: number; width: number; height: number },
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

test("floating chrome leaves first critical public content reachable at 320px and 390px", async ({ page }) => {
	for (const viewport of [
		{ width: 320, height: 800 },
		{ width: 390, height: 844 },
	]) {
		await page.setViewportSize(viewport);
		for (const route of publicRoutes) {
			await expectFirstCriticalContentClear(page, route);
		}
	}
});

test("representative public surfaces remain clear at the 200% zoom-equivalent viewport", async ({ page }) => {
	await page.setViewportSize({ width: 683, height: 384 });
	for (const route of ["/sessoes", "/lore", "/diario", "/lembra"] as const) {
		await expectFirstCriticalContentClear(page, route);
	}
});
