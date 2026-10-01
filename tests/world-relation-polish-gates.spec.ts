import { expect, test, type Page } from "@playwright/test";

type Box = NonNullable<Awaited<ReturnType<ReturnType<Page["locator"]>["boundingBox"]>>>;

function overlapArea(a: Box, b: Box) {
	const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
	const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
	return width * height;
}

async function closeWorkspaceOverlays(page: Page) {
	const navigationClose = page.getByRole("button", { name: "Recolher navegação do mundo" });
	if (await navigationClose.isVisible().catch(() => false)) await navigationClose.click();
	const inspectorClose = page.getByRole("button", { name: "Recolher painel de detalhes" });
	if (await inspectorClose.isVisible().catch(() => false)) await inspectorClose.click();
}

test("World relation hover reinforces exactly one path and its two endpoints", async ({ page }, testInfo) => {
	test.skip(testInfo.project.name === "mobile", "Fine-pointer relation hover contract.");

	await page.setViewportSize({ width: 1366, height: 768 });
	await page.goto("/campanhas/cronicas-da-mesa/mundo");
	await closeWorkspaceOverlays(page);

	const edgeId = "astel-raven-queen";
	const nativeEdge = page.locator(`.react-flow__edge[data-id="${edgeId}"]`);
	const visiblePath = page.locator(`[data-world-edge="${edgeId}"]`);
	const astel = page.locator('[data-world-node="astel"]');
	const raven = page.locator('[data-world-node="raven-queen"]');

	await expect(nativeEdge).toHaveCount(1);
	await expect(visiblePath).toBeVisible();
	await nativeEdge.dispatchEvent("mouseover");

	await expect(visiblePath).toHaveAttribute("data-world-edge-active", "true");
	await expect(astel).toHaveAttribute("data-world-relation-endpoint", "true");
	await expect(raven).toHaveAttribute("data-world-relation-endpoint", "true");

	const unrelated = page.locator('[data-world-node="dandelion"]');
	await expect(unrelated).toHaveAttribute("data-world-relation-endpoint", "false");

	await nativeEdge.dispatchEvent("mouseout");
	await expect(astel).toHaveAttribute("data-world-relation-endpoint", "false");
	await expect(raven).toHaveAttribute("data-world-relation-endpoint", "false");
});

test("World selected relations expose an actionable continuation cue when zoom pushes a target off-screen", async ({
	page,
}, testInfo) => {
	test.skip(testInfo.project.name === "mobile", "Desktop off-screen continuation receipt.");

	await page.setViewportSize({ width: 1366, height: 768 });
	await page.goto("/campanhas/cronicas-da-mesa/mundo");
	await closeWorkspaceOverlays(page);

	const astel = page.locator('[data-world-node="astel"]');
	await astel.click();
	const box = await astel.boundingBox();
	expect(box).not.toBeNull();
	if (!box) return;

	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	for (let index = 0; index < 6; index += 1) {
		await page.mouse.wheel(0, -520);
	}

	const cues = page.locator("[data-world-offscreen-edge]");
	await expect.poll(async () => cues.count()).toBeGreaterThan(0);

	const cue = cues.first();
	const targetId = await cue.getAttribute("data-world-offscreen-target");
	expect(targetId).toBeTruthy();
	await expect(cue).toHaveAttribute("data-world-offscreen-boundary", /top|right|bottom|left/u);
	await expect(cue).toHaveAccessibleName(/mostrar/u);

	await cue.click();
	if (targetId) {
		await expect(page.locator(`[data-world-node="${targetId}"]`)).toBeVisible();
	}
});

test("World canvas utilities keep independent corner safe areas without overlapping contextual chrome", async ({
	page,
}, testInfo) => {
	test.skip(testInfo.project.name === "mobile", "Desktop corner geometry contract.");

	await page.setViewportSize({ width: 1920, height: 1080 });
	await page.goto("/campanhas/cronicas-da-mesa/mundo");

	const canvas = page.getByTestId("world-canvas");
	const filterRail = page.getByTestId("world-filter-rail");
	const minimap = page.locator(".react-flow__minimap");
	const controls = page.locator(".react-flow__controls");
	const [canvasBox, filterBox, minimapBox, controlsBox] = await Promise.all([
		canvas.boundingBox(),
		filterRail.boundingBox(),
		minimap.boundingBox(),
		controls.boundingBox(),
	]);

	for (const box of [canvasBox, filterBox, minimapBox, controlsBox]) expect(box).not.toBeNull();
	if (!canvasBox || !filterBox || !minimapBox || !controlsBox) return;

	expect(overlapArea(minimapBox, controlsBox)).toBe(0);
	expect(overlapArea(filterBox, minimapBox)).toBe(0);
	expect(overlapArea(filterBox, controlsBox)).toBe(0);

	const receipt = page.getByTestId("world-published-version");
	if ((await receipt.count()) === 1) {
		const receiptBox = await receipt.boundingBox();
		expect(receiptBox).not.toBeNull();
		if (receiptBox) {
			expect(receiptBox.x).toBeGreaterThanOrEqual(canvasBox.x);
			expect(receiptBox.y).toBeGreaterThanOrEqual(canvasBox.y);
			expect(receiptBox.x + receiptBox.width).toBeLessThanOrEqual(canvasBox.x + canvasBox.width + 1);
			expect(receiptBox.y + receiptBox.height).toBeLessThanOrEqual(canvasBox.y + canvasBox.height + 1);
			expect(overlapArea(receiptBox, filterBox)).toBe(0);
			expect(overlapArea(receiptBox, minimapBox)).toBe(0);
		}

		const inspector = page.locator("#world-workspace-inspector");
		const inspectorBox = await inspector.boundingBox();
		if (receiptBox && inspectorBox && inspectorBox.width > 1) {
			expect(receiptBox.x + receiptBox.width).toBeLessThanOrEqual(inspectorBox.x + 1);
		}
	}

	const receiptPath = testInfo.outputPath("world-relation-polish-1920x1080.png");
	await page.screenshot({ path: receiptPath });
	await testInfo.attach("world-relation-polish-1920x1080", {
		path: receiptPath,
		contentType: "image/png",
	});
});
