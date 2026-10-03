import { expect, test, type Page } from "@playwright/test";

type Box = NonNullable<Awaited<ReturnType<ReturnType<Page["locator"]>["boundingBox"]>>>;

function overlapArea(a: Box, b: Box) {
	const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
	const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
	return width * height;
}


async function expectPaintedWorldEdge(page: Page, edgeId: string) {
	const edge = page.locator(`[data-world-edge="${edgeId}"]`);
	await expect(edge).toBeVisible();
	const receipt = await edge.evaluate((element) => {
		const path = element as SVGPathElement;
		const totalLength = path.getTotalLength();
		const mid = path.getPointAtLength(totalLength / 2);
		const matrix = path.getScreenCTM();
		if (!matrix) throw new Error("Selected World edge has no screen transform");
		const screenMid = new DOMPoint(mid.x, mid.y).matrixTransform(matrix);
		const canvas = path.closest('[data-testid="world-canvas"]') as HTMLElement | null;
		if (!canvas) throw new Error("Selected World edge is outside the World canvas");
		const canvasBox = canvas.getBoundingClientRect();
		const style = getComputedStyle(path);
		const strokePoint = path.ownerSVGElement?.createSVGPoint();
		if (!strokePoint) throw new Error("Selected World edge has no SVG point factory");
		strokePoint.x = mid.x;
		strokePoint.y = mid.y;
		const edgeLayer = document.querySelector(".react-flow__edges");
		const nodeLayer = document.querySelector(".react-flow__nodes");
		const portalLayer = document.querySelector(".react-flow__viewport-portal");
		return {
			totalLength,
			strokeWidth: Number.parseFloat(style.strokeWidth),
			strokeOpacity: Number.parseFloat(style.strokeOpacity),
			display: style.display,
			visibility: style.visibility,
			inStroke:
				typeof path.isPointInStroke === "function"
					? path.isPointInStroke(strokePoint)
					: true,
			screenMid,
			canvas: {
				left: canvasBox.left,
				top: canvasBox.top,
				right: canvasBox.right,
				bottom: canvasBox.bottom,
			},
			z: {
				portal: Number.parseInt(getComputedStyle(portalLayer!).zIndex || "0", 10),
				edges: Number.parseInt(getComputedStyle(edgeLayer!).zIndex || "0", 10),
				nodes: Number.parseInt(getComputedStyle(nodeLayer!).zIndex || "0", 10),
			},
		};
	});
	expect(receipt.totalLength).toBeGreaterThan(20);
	expect(receipt.strokeWidth).toBeGreaterThan(0);
	expect(receipt.strokeOpacity).toBeGreaterThan(0.5);
	expect(receipt.display).not.toBe("none");
	expect(receipt.visibility).not.toBe("hidden");
	expect(receipt.inStroke).toBe(true);
	expect(receipt.z.portal).toBeLessThan(receipt.z.edges);
	expect(receipt.z.edges).toBeLessThan(receipt.z.nodes);
	expect(receipt.screenMid.x).toBeGreaterThanOrEqual(receipt.canvas.left - 2);
	expect(receipt.screenMid.x).toBeLessThanOrEqual(receipt.canvas.right + 2);
	expect(receipt.screenMid.y).toBeGreaterThanOrEqual(receipt.canvas.top - 2);
	expect(receipt.screenMid.y).toBeLessThanOrEqual(receipt.canvas.bottom + 2);
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


test("World selected relation strokes paint above neighborhoods and stay attached through camera changes", async ({
	page,
}, testInfo) => {
	test.skip(testInfo.project.name === "mobile", "Desktop painting receipt uses the full graph.");

	await page.setViewportSize({ width: 1366, height: 768 });
	await page.goto("/campanhas/cronicas-da-mesa/mundo");
	await closeWorkspaceOverlays(page);

	await page.locator('[data-world-node="astel"]').click();
	await expect(page.locator('[data-world-edge="astel-raven-queen"]')).toHaveAttribute(
		"data-world-edge-active",
		"true",
	);
	await expectPaintedWorldEdge(page, "astel-raven-queen");

	const canvas = page.getByTestId("world-canvas");
	const box = await canvas.boundingBox();
	expect(box).not.toBeNull();
	if (box) {
		await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
		await page.mouse.wheel(0, -360);
		await page.waitForTimeout(180);
		await expectPaintedWorldEdge(page, "astel-raven-queen");
	}

	await page.locator('[data-world-node="dandelion"]').click();
	await expect(page.locator('[data-world-edge="dandelion-astel"]')).toHaveAttribute(
		"data-world-edge-active",
		"true",
	);
	await expectPaintedWorldEdge(page, "dandelion-astel");

	const receiptPath = testInfo.outputPath("world-selected-relation-paint.png");
	await page.screenshot({ path: receiptPath });
	await testInfo.attach("world-selected-relation-paint", {
		path: receiptPath,
		contentType: "image/png",
	});
});
