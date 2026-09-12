import { expect, test } from "@playwright/test";

for (const lore of ["d", "seika"]) {
	test(`${lore}: original art loads and gallery opens without distortion`, async ({ page }) => {
		test.setTimeout(120000);
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.goto(`/lore/${lore}`);
		await expect(page.locator("h1")).toBeVisible();
		const images = page.locator("img[src]:not(dialog img)");
		// Scroll every authored image into view so lazy loading is exercised too.
		for (const image of await images.all()) {
			await image.scrollIntoViewIfNeeded();
			await expect.poll(() => image.evaluate((element) => {
				const img = element as HTMLImageElement;
				return img.complete && img.naturalWidth > 0;
			}), { timeout: 15000 }).toBe(true);
		}
		await expect.poll(() => page.evaluate(() =>
			document.documentElement.scrollWidth <= window.innerWidth + 1,
		)).toBe(true);
		const button = page.locator(lore === "d" ? ".image-button" : ".archive-item").first();
		await button.click();
		await expect(page.locator("dialog")).toBeVisible();
		await expect.poll(() => page.locator("dialog img").evaluate((element) =>
			(element as HTMLImageElement).naturalWidth,
		)).toBeGreaterThan(0);
		await page.keyboard.press("Escape");
		await expect(page.locator("dialog")).not.toBeVisible();
		expect(errors).toEqual([]);
	});
}

test("Seika keeps foreground characters separate from scene backgrounds", async ({ page, isMobile, viewport }) => {
	await page.goto("/lore/seika");
	if (isMobile || (viewport && viewport.width <= 800)) {
		const copy = await page.locator(".hero-copy").boundingBox();
		const portrait = await page.locator(".hero-character").boundingBox();
		expect(copy).not.toBeNull();
		expect(portrait).not.toBeNull();
		expect(portrait!.y).toBeGreaterThanOrEqual(copy!.y + copy!.height);
	}
	for (const selector of [".lucky-scene", ".ritual-scene", ".departure-layered"]) {
		const scene = page.locator(selector);
		await expect(scene.locator("img")).toHaveCount(2);
		const sources = await scene.locator("img").evaluateAll((images) => images.map((img) => (img as HTMLImageElement).src));
		expect(sources[0]).not.toBe(sources[1]);
		expect(sources.some((src) => src.includes("subject"))).toBe(true);
	}
	await expect(page.locator(".archive-item")).toHaveCount(25);
});
