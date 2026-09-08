import { expect, test } from "@playwright/test";

test("World Explorer nodes use semantic silhouettes and floating edge anchors", async ({ page }) => {
	await page.goto("/mundo");

	const hero = page.locator('[data-world-node="dandelion"]');
	const location = page.locator('[data-world-node="reino-fadas"]');
	const faction = page.locator('[data-world-node="zhentarim"]');
	const moment = page.locator('[data-world-node="fantasminhos"]');
	await expect(hero).toBeVisible();
	await expect(location).toBeVisible();
	await expect(faction).toBeVisible();
	await expect(moment).toBeVisible();

	await expect(hero).toHaveAttribute("data-node-kind", "hero");
	await expect(location).toHaveAttribute("data-node-kind", "location");
	await expect(faction).toHaveAttribute("data-node-kind", "faction");
	await expect(moment).toHaveAttribute("data-node-kind", "moment");

	const heroBox = await hero.boundingBox();
	const locationBox = await location.boundingBox();
	expect(heroBox).not.toBeNull();
	expect(locationBox).not.toBeNull();
	if (!heroBox || !locationBox) return;
	expect(Math.abs(heroBox.width - heroBox.height)).toBeLessThan(2);
	expect(heroBox.width).toBeGreaterThan(locationBox.width);

	const label = hero.locator("[data-node-label]");
	const labelBox = await label.boundingBox();
	expect(labelBox).not.toBeNull();
	if (labelBox) expect(labelBox.y).toBeGreaterThanOrEqual(heroBox.y + heroBox.height - 1);

	const edge = page.locator('[data-world-edge="dandelion-astel"]');
	await expect(edge).toBeVisible();
	await expect(edge).toHaveAttribute("data-edge-anchor", "floating");
});

test("floating World Explorer edge geometry follows a dragged hero", async ({ page }, testInfo) => {
	test.skip(
		testInfo.project.name === "mobile",
		"Freeform mouse dragging is a desktop canvas interaction; mobile validates the same floating geometry and anchors without synthesizing a mouse drag.",
	);

	await page.goto("/mundo");
	const hero = page.locator('[data-world-node="astel"]');
	const edge = page.locator('[data-world-edge="dandelion-astel"]');
	await expect(hero).toBeVisible();
	await expect(edge).toBeVisible();

	const before = await edge.getAttribute("d");
	const box = await hero.boundingBox();
	expect(box).not.toBeNull();
	if (!box) return;

	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + 110, box.y + box.height / 2 + 55, { steps: 8 });
	await page.mouse.up();

	await expect.poll(() => edge.getAttribute("d")).not.toBe(before);
	await expect(edge).toHaveAttribute("data-edge-anchor", "floating");
});
