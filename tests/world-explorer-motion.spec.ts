import { expect, test } from "@playwright/test";

test("World Explorer animates only the relations connected to the selected node", async ({ page }) => {
	await page.goto("/mundo");
	await expect(page.locator("[data-world-edge-motion]")).toHaveCount(0);

	await page.locator('[data-world-node="astel"]').click();
	const motionPaths = page.locator("[data-world-edge-motion]");
	await expect(motionPaths.first()).toBeVisible();
	expect(await motionPaths.count()).toBeGreaterThan(0);

	const paint = await motionPaths.first().evaluate((element) => {
		const style = getComputedStyle(element);
		return {
			animationName: style.animationName,
			animationDuration: style.animationDuration,
			strokeDasharray: style.strokeDasharray,
			strokeWidth: Number.parseFloat(style.strokeWidth),
		};
	});

	expect(paint.animationName).not.toBe("none");
	expect(paint.animationDuration).not.toBe("0s");
	expect(paint.strokeDasharray).not.toBe("none");
	expect(paint.strokeWidth).toBeGreaterThanOrEqual(2);
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
});

test("World Explorer relation legend uses DS chips instead of the native fieldset frame", async ({ page }) => {
	await page.goto("/mundo");
	const legend = page.locator("fieldset:has(> span[data-family])");
	await expect(legend).toBeVisible();

	const frame = await legend.evaluate((element) => {
		const style = getComputedStyle(element);
		return {
			borderTopWidth: style.borderTopWidth,
			borderRightWidth: style.borderRightWidth,
			marginTop: style.marginTop,
		};
	});
	expect(frame.borderTopWidth).toBe("0px");
	expect(frame.borderRightWidth).toBe("0px");
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
	expect(chip.swatchWidth).toBeGreaterThanOrEqual(16);
	expect(chip.swatchHeight).toBeLessThanOrEqual(3);
});
