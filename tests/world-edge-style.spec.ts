import { expect, test } from "@playwright/test";

test("World Explorer uses organic bezier geometry for visible relations", async ({ page }) => {
	await page.goto("/campanhas/cronicas-da-mesa/mundo");
	await expect(page.locator('[data-world-node="dandelion"]')).toBeVisible();

	const edgeLayer = page.locator(
		'.react-flow__viewport svg[data-world-edge-layer="viewport"]',
	).first();
	await expect(edgeLayer).toBeVisible();

	const edge = edgeLayer.locator('[data-world-edge][data-edge-curve="bezier"]').first();
	await expect(edge).toBeVisible();

	const geometry = await edge.evaluate((element) => {
		const path = element as SVGPathElement;
		return {
			d: path.getAttribute("d") ?? "",
			length: path.getTotalLength(),
			strokeLinecap: getComputedStyle(path).strokeLinecap,
		};
	});

	await expect(edgeLayer).toHaveAttribute("data-world-edge-layer", "viewport");
	expect(geometry.d).toContain("C");
	expect(geometry.length).toBeGreaterThan(20);
	expect(geometry.strokeLinecap).toBe("round");
});
