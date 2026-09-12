import { expect, test } from "@playwright/test";

test("World canvas uses map-style pan and zoom without scrolling the document", async ({
	page,
}, testInfo) => {
	test.skip(testInfo.project.name === "mobile", "Mouse wheel and fine-pointer pan contract.");

	await page.setViewportSize({ width: 1366, height: 768 });
	await page.goto("/mundo");

	const canvas = page.getByTestId("world-canvas");
	const viewport = page.locator(".react-flow__viewport");
	await expect(canvas).toBeVisible();
	await expect(viewport).toBeVisible();

	const canvasBox = await canvas.boundingBox();
	expect(canvasBox).not.toBeNull();
	if (!canvasBox) return;

	const transform = () => viewport.evaluate((element) => (element as HTMLElement).style.transform);
	const initialTransform = await transform();

	await page.mouse.move(
		canvasBox.x + canvasBox.width * 0.78,
		canvasBox.y + canvasBox.height * 0.18,
	);
	await page.mouse.wheel(0, -420);

	await expect.poll(transform).not.toBe(initialTransform);
	const zoomedTransform = await transform();

	// Top-left is deliberately away from the seeded constellation and from the
	// bottom-corner React Flow controls. Dragging empty space must pan the world.
	const startX = canvasBox.x + 36;
	const startY = canvasBox.y + 36;
	await page.mouse.move(startX, startY);
	await page.mouse.down();
	await page.mouse.move(startX + 84, startY + 56, { steps: 6 });
	await page.mouse.up();

	await expect.poll(transform).not.toBe(zoomedTransform);
	await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
	await expect
		.poll(() => page.evaluate(() => getComputedStyle(document.body).overflowY))
		.toBe("hidden");
});
