import { expect, test } from "@playwright/test";

test("World Explorer visibly animates only the relations connected to the selected node", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await page.goto("/mundo");
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
	await page.goto("/mundo");
	await page.locator('[data-world-node="astel"]').click();

	const motionPath = page.locator("[data-world-edge-motion]").first();
	await expect(motionPath).toBeVisible();
	await expect
		.poll(() => motionPath.evaluate((element) => getComputedStyle(element).animationName))
		.toBe("none");
	expect(await motionPath.evaluate((element) => element.getAnimations().length)).toBe(0);
});

test("World Explorer relation legend uses DS chips and stays out of the mobile first viewport", async ({
	page,
}, testInfo) => {
	await page.goto("/mundo");
	const legend = page.locator("fieldset:has(> span[data-family])");

	if (testInfo.project.name === "mobile") {
		await expect(legend).toBeHidden();
		return;
	}

	await expect(legend).toBeVisible();
	const frame = await legend.evaluate((element) => {
		const style = getComputedStyle(element);
		return {
			borderTopWidth: style.borderTopWidth,
			borderRightWidth: style.borderRightWidth,
			borderBottomWidth: style.borderBottomWidth,
			boxShadow: style.boxShadow,
			marginTop: style.marginTop,
		};
	});
	expect(frame.borderTopWidth).toBe("0px");
	expect(frame.borderRightWidth).toBe("0px");
	expect(frame.borderBottomWidth).toBe("0px");
	expect(frame.boxShadow).toBe("none");
	expect(frame.marginTop).toBe("0px");

	const affinity = legend.locator('span[data-family="affinity"]');
	const chip = await affinity.evaluate((element) => {
		const style = getComputedStyle(element);
		const swatch = getComputedStyle(element, "::before");
		return {
			borderRadius: style.borderTopLeftRadius,
			swatchWidth: Number.parseFloat(swatch.width),
			swatchHeight: Number.parseFloat(swatch.height),
		};
	});
	expect(chip.borderRadius).not.toBe("0px");
	expect(chip.swatchWidth).toBeGreaterThanOrEqual(18);
	expect(chip.swatchHeight).toBeLessThanOrEqual(3);
});
