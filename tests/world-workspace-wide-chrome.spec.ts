import { expect, test } from "@playwright/test";

function centerY(box: { y: number; height: number } | null) {
	return box ? box.y + box.height / 2 : Number.NaN;
}

test("wide World workspace uses one control row and floats filters over the canvas", async ({ page }, testInfo) => {
	test.skip(testInfo.project.name === "mobile", "Wide workspace contract.");
	await page.goto("/mundo");
	const viewport = page.viewportSize();
	if (!viewport || viewport.width < 1920) test.skip();

	const heading = page.getByRole("heading", { level: 1, name: "Ecos da Jornada" });
	await expect(heading).toHaveCount(1);

	const search = page.locator("[data-world-search]");
	const relation = page.locator("[data-world-relation-filter]");
	const reset = page.locator("[data-world-layout-action]");
	const viewToggle = page.locator("[data-world-view-toggle]");
	const rowBoxes = await Promise.all([
		search.boundingBox(),
		relation.boundingBox(),
		reset.boundingBox(),
		viewToggle.boundingBox(),
	]);
	for (const box of rowBoxes) expect(box).not.toBeNull();
	const rowCenter = centerY(rowBoxes[0]);
	for (const box of rowBoxes.slice(1)) {
		expect(Math.abs(centerY(box) - rowCenter)).toBeLessThan(3);
	}

	const conductor = page.getByTestId("world-conductor");
	if (await conductor.count()) {
		const conductorBox = await conductor.boundingBox();
		expect(conductorBox).not.toBeNull();
		expect(Math.abs(centerY(conductorBox) - rowCenter)).toBeLessThan(3);
	}

	const canvas = page.getByTestId("world-canvas");
	const filters = page.getByRole("group", { name: "Filtrar o grafo" });
	const canvasBox = await canvas.boundingBox();
	const filterBox = await filters.boundingBox();
	expect(canvasBox).not.toBeNull();
	expect(filterBox).not.toBeNull();
	expect((filterBox?.y ?? 0) + (filterBox?.height ?? 0)).toBeGreaterThan(canvasBox?.y ?? 0);
	expect(filterBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan((canvasBox?.y ?? 0) + 100);

	const all = page.getByRole("button", { name: "Todos", exact: true });
	const characters = page.getByRole("button", { name: "Personagens", exact: true });
	await expect(all).toHaveAttribute("aria-pressed", "true");
	await characters.click();
	await expect(characters).toHaveAttribute("aria-pressed", "true");
	await expect(all).toHaveAttribute("aria-pressed", "false");

	expect(await page.evaluate(() => window.scrollY)).toBe(0);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});
