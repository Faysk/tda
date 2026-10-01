import { expect, test } from "@playwright/test";

test("World Explorer visibly animates only the relations connected to the selected node", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await page.goto("/campanhas/cronicas-da-mesa/mundo");
	await expect(page.locator("[data-world-edge-motion]")).toHaveCount(0);

	await page.locator('[data-world-node="astel"]').click();
	const motionPaths = page.locator("[data-world-edge-motion]");
	await expect(motionPaths.first()).toBeVisible();
	expect(await motionPaths.count()).toBeGreaterThan(0);

	const motionPath = motionPaths.first();
	const edgeId = await motionPath.getAttribute("data-world-edge-motion");
	expect(edgeId).toBeTruthy();
	const basePath = page.locator(`[data-world-edge="${edgeId}"]`);
	await expect(basePath).toBeVisible();

	const paint = await motionPath.evaluate((element) => {
		const style = getComputedStyle(element);
		const animations = element.getAnimations();
		return {
			animationName: style.animationName,
			animationDuration: style.animationDuration,
			stroke: style.stroke,
			strokeDasharray: style.strokeDasharray,
			strokeWidth: Number.parseFloat(style.strokeWidth),
			animationCount: animations.length,
			currentTime: Number(animations[0]?.currentTime ?? 0),
		};
	});
	const baseStroke = await basePath.evaluate((element) => getComputedStyle(element).stroke);

	expect(paint.animationName).not.toBe("none");
	expect(paint.animationDuration).not.toBe("0s");
	expect(paint.strokeDasharray).not.toBe("none");
	expect(paint.strokeWidth).toBeGreaterThanOrEqual(2);
	expect(paint.stroke).not.toBe(baseStroke);
	expect(paint.animationCount).toBeGreaterThan(0);

	await page.waitForTimeout(180);
	const laterTime = await motionPath.evaluate((element) =>
		Number(element.getAnimations()[0]?.currentTime ?? 0),
	);
	expect(laterTime).toBeGreaterThan(paint.currentTime + 60);
});

test("World Explorer stops relation motion when reduced motion is requested", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto("/campanhas/cronicas-da-mesa/mundo");
	await page.locator('[data-world-node="astel"]').click();

	const motionPath = page.locator("[data-world-edge-motion]").first();
	await expect(motionPath).toBeVisible();
	await expect
		.poll(() => motionPath.evaluate((element) => getComputedStyle(element).animationName))
		.toBe("none");
	expect(await motionPath.evaluate((element) => element.getAnimations().length)).toBe(0);
});

test("World Explorer keeps the relation legend contextual inside the relation disclosure", async ({
	page,
}, testInfo) => {
	await page.goto("/campanhas/cronicas-da-mesa/mundo");
	const trigger = page.locator('summary[aria-label="Filtrar por relação"]');
	const legend = page.getByRole("list", { name: "Legenda de relações" });

	await expect(trigger).toBeVisible();
	await expect(legend).toBeHidden();

	const triggerBox = await trigger.boundingBox();
	expect(triggerBox).not.toBeNull();
	if (testInfo.project.name === "mobile") {
		expect(triggerBox?.height ?? 0).toBeGreaterThanOrEqual(44);
	}

	await trigger.click();
	await expect(legend).toBeVisible();

	const affinity = legend.locator('[data-family="affinity"]');
	await expect(affinity).toBeVisible();
	const swatch = affinity.locator("i");
	const swatchBox = await swatch.boundingBox();
	expect(swatchBox).not.toBeNull();
	expect(swatchBox?.width ?? 0).toBeGreaterThanOrEqual(18);
	expect(swatchBox?.height ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(4);

	expect(
		await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
	).toBeTruthy();

	await page.keyboard.press("Escape");
	await expect(legend).toBeHidden();
	await expect(trigger).toBeFocused();
});
