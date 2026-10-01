import { expect, test, type Locator, type Page } from "@playwright/test";

type Point = { x: number; y: number };
type Box = { x: number; y: number; width: number; height: number };

async function visibleEdgeEndpoints(path: Locator): Promise<{ start: Point; end: Point }> {
	return path.evaluate((element) => {
		const edge = element as SVGPathElement;
		const matrix = edge.getScreenCTM();
		if (!matrix) throw new Error("World edge has no screen transform");
		const toScreen = (point: DOMPoint) => point.matrixTransform(matrix);
		const start = toScreen(edge.getPointAtLength(0));
		const end = toScreen(edge.getPointAtLength(edge.getTotalLength()));
		return {
			start: { x: start.x, y: start.y },
			end: { x: end.x, y: end.y },
		};
	});
}

function distanceToRect(point: Point, box: Box) {
	const dx = Math.max(box.x - point.x, 0, point.x - (box.x + box.width));
	const dy = Math.max(box.y - point.y, 0, point.y - (box.y + box.height));
	return Math.hypot(dx, dy);
}

async function expectEdgeAnchored(page: Page, edgeId: string, sourceId: string, targetId: string) {
	const edge = page.locator(`[data-world-edge="${edgeId}"]`);
	const source = page.locator(`[data-world-node="${sourceId}"]`);
	const target = page.locator(`[data-world-node="${targetId}"]`);
	await expect(edge).toBeVisible();
	await expect(source).toBeVisible();
	await expect(target).toBeVisible();

	const [points, sourceBox, targetBox] = await Promise.all([
		visibleEdgeEndpoints(edge),
		source.boundingBox(),
		target.boundingBox(),
	]);
	expect(sourceBox).not.toBeNull();
	expect(targetBox).not.toBeNull();
	if (!sourceBox || !targetBox) return;

	expect(distanceToRect(points.start, sourceBox), "source endpoint must stay on the source node").toBeLessThanOrEqual(6);
	expect(distanceToRect(points.end, targetBox), "target endpoint must stay on the target node").toBeLessThanOrEqual(6);
}

async function closeWorkspaceOverlays(page: Page) {
	const navigationClose = page.getByRole("button", { name: "Recolher navegação do mundo" });
	if (await navigationClose.isVisible().catch(() => false)) await navigationClose.click();
	const inspectorClose = page.getByRole("button", { name: "Recolher painel de detalhes" });
	if (await inspectorClose.isVisible().catch(() => false)) await inspectorClose.click();
}

test("World visible relation endpoints remain anchored through pan, zoom, resize and restore", async ({
	page,
}, testInfo) => {
	test.skip(testInfo.project.name === "mobile", "Fine-pointer geometry contract.");

	await page.setViewportSize({ width: 1366, height: 768 });
	await page.goto("/campanhas/cronicas-da-mesa/mundo");
	await closeWorkspaceOverlays(page);

	const edgeId = "astel-raven-queen";
	await expectEdgeAnchored(page, edgeId, "astel", "raven-queen");

	const canvas = page.getByTestId("world-canvas");
	const canvasBox = await canvas.boundingBox();
	expect(canvasBox).not.toBeNull();
	if (!canvasBox) return;

	await page.mouse.move(
		canvasBox.x + canvasBox.width * 0.52,
		canvasBox.y + canvasBox.height * 0.48,
	);
	await page.mouse.wheel(0, -460);
	await page.waitForTimeout(180);
	await expectEdgeAnchored(page, edgeId, "astel", "raven-queen");

	const startX = canvasBox.x + 40;
	const startY = canvasBox.y + 40;
	await page.mouse.move(startX, startY);
	await page.mouse.down();
	await page.mouse.move(startX + 110, startY + 64, { steps: 6 });
	await page.mouse.up();
	await page.waitForTimeout(120);
	await expectEdgeAnchored(page, edgeId, "astel", "raven-queen");

	await page.setViewportSize({ width: 1920, height: 1080 });
	await page.waitForTimeout(160);
	await expectEdgeAnchored(page, edgeId, "astel", "raven-queen");

	await page.reload();
	await closeWorkspaceOverlays(page);
	await expectEdgeAnchored(page, edgeId, "astel", "raven-queen");
});
