import { expect, test } from "@playwright/test";

test("World canvas uses map-style pan and zoom without scrolling the document", async ({
	page,
}, testInfo) => {
	test.skip(testInfo.project.name === "mobile", "Mouse wheel and fine-pointer pan contract.");

	await page.setViewportSize({ width: 1366, height: 768 });
	await page.goto("/mundo");

	// Side surfaces are overlays by design. Close them before exercising the
	// spatial surface so the pointer lands on React Flow rather than drawer UI.
	await page.getByRole("button", { name: "Recolher navegação do mundo" }).click();
	await page.getByRole("button", { name: "Recolher painel de detalhes" }).click();

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
		canvasBox.x + canvasBox.width * 0.5,
		canvasBox.y + canvasBox.height * 0.5,
	);
	await page.mouse.wheel(0, -420);

	await expect.poll(transform).not.toBe(initialTransform);
	const zoomedTransform = await transform();

	// Top-left stays away from the seeded constellation and the bottom-corner
	// React Flow controls. Dragging empty space must pan the world.
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

test("World canvas switches presentation tiers instead of shrinking all detail forever", async ({
	page,
}, testInfo) => {
	test.skip(testInfo.project.name === "mobile", "Fine-grained zoom control contract.");

	await page.setViewportSize({ width: 1366, height: 768 });
	await page.goto("/mundo");
	await page.getByRole("button", { name: "Recolher navegação do mundo" }).click();
	await page.getByRole("button", { name: "Recolher painel de detalhes" }).click();

	const canvas = page.getByTestId("world-canvas");
	const zoomOut = page.getByRole("button", { name: "Diminuir zoom" });
	await expect(canvas).toBeVisible();

	for (let index = 0; index < 8; index += 1) {
		await zoomOut.click();
	}
	await expect(canvas).toHaveAttribute("data-world-semantic-zoom", "atlas");

	await expect(
		page.locator('[data-world-node="astel"] [data-node-label]'),
	).toBeVisible();
	await expect(
		page.locator('[data-world-node="raven-queen"] [data-node-label]'),
	).toHaveCount(0);
	await expect(page.locator("[data-world-neighborhood-layer]")).toBeVisible();

	await page.locator('[data-world-node="astel"]').click();
	await expect(canvas).toHaveAttribute("data-world-semantic-zoom", "detail");
	await expect(
		page.locator('[data-world-node="astel"] [data-node-label]'),
	).toBeVisible();
});

