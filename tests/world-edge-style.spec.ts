import { expect, test } from "@playwright/test";

test("World Explorer uses organic bezier geometry for visible relations", async ({ page }) => {
	await page.goto("/campanhas/cronicas-da-mesa/mundo");
	await expect(page.locator('[data-world-node="dandelion"]')).toBeVisible();

	const edge = page
		.locator('.react-flow__edge [data-world-edge][data-edge-curve="bezier"]')
		.first();
	await expect(edge).toBeVisible();

	const geometry = await edge.evaluate((element) => {
		const path = element as SVGPathElement;
		return {
			d: path.getAttribute("d") ?? "",
			length: path.getTotalLength(),
			strokeLinecap: getComputedStyle(path).strokeLinecap,
		};
	});

	expect(geometry.d).toContain("C");
	expect(geometry.length).toBeGreaterThan(20);
	expect(geometry.strokeLinecap).toBe("round");
	expect(
		await edge.evaluate((element) => Boolean(element.closest(".react-flow__viewport-portal"))),
	).toBe(true);
	expect(
		await edge.evaluate((element) => Boolean(element.closest("g.react-flow__edge"))),
	).toBe(false);
	await expect(page.locator(".react-flow__edge .react-flow__edge-interaction").first()).toBeVisible();
});
