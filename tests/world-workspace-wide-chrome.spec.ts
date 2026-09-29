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

test("wide World workspace uses one safe control row and keeps contextual chrome inside the canvas", async ({ page }, testInfo) => {
	test.skip(testInfo.project.name === "mobile", "Wide workspace contract.");
	await page.goto("/mundo");
	const viewport = page.viewportSize();
	if (!viewport || viewport.width < 1920) test.skip();

	const heading = page.getByRole("heading", { level: 1, name: "Ecos da Jornada" });
	await expect(heading).toHaveCount(1);
	await expect(page.locator("[data-world-workspace-bar]")).toHaveCount(1);

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
	const rowY = rowBoxes[0]?.y ?? 0;
	for (const box of rowBoxes.slice(1)) {
		expect(Math.abs((box?.y ?? rowY) - rowY)).toBeLessThan(3);
	}

	const conductor = page.getByTestId("world-conductor");
	if (await conductor.count()) {
		const conductorBox = await conductor.boundingBox();
		expect(conductorBox).not.toBeNull();
		expect(Math.abs((conductorBox?.y ?? rowY) - rowY)).toBeLessThan(3);
	}

	const brand = page.locator(".brand");
	const avatar = page.locator(".account-menu-trigger");
	const [brandBox, searchBox, avatarBox, resetBox, viewBox] = await Promise.all([
		brand.boundingBox(),
		search.boundingBox(),
		avatar.boundingBox(),
		reset.boundingBox(),
		viewToggle.boundingBox(),
	]);
	for (const box of [brandBox, searchBox, avatarBox, resetBox, viewBox]) expect(box).not.toBeNull();
	if (brandBox && searchBox) expect(overlapArea(brandBox, searchBox)).toBe(0);
	if (avatarBox && resetBox) expect(overlapArea(avatarBox, resetBox)).toBe(0);
	if (avatarBox && viewBox) expect(overlapArea(avatarBox, viewBox)).toBe(0);

	const canvas = page.getByTestId("world-canvas");
	const filters = page.getByRole("group", { name: "Filtrar o grafo" });
	const [canvasBox, filterBox] = await Promise.all([canvas.boundingBox(), filters.boundingBox()]);
	expect(canvasBox).not.toBeNull();
	expect(filterBox).not.toBeNull();
	expect((filterBox?.y ?? 0) + (filterBox?.height ?? 0)).toBeGreaterThan(canvasBox?.y ?? 0);
	expect(filterBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan((canvasBox?.y ?? 0) + 100);
	expect(await filters.evaluate((element) => element.closest('[data-testid="world-canvas"]') !== null)).toBeTruthy();

	const permanentLegend = page.getByRole("list", { name: "Legenda de relações" });
	await expect(permanentLegend).toBeHidden();

	const leftTab = page.getByRole("button", { name: "Recolher navegação do mundo" });
	const rightTab = page.getByRole("button", { name: "Recolher painel de detalhes" });
	const [leftBox, rightBox] = await Promise.all([leftTab.boundingBox(), rightTab.boundingBox()]);
	expect(leftBox).not.toBeNull();
	expect(rightBox).not.toBeNull();
	expect(Math.abs((leftBox?.width ?? 0) - (rightBox?.width ?? 0))).toBeLessThan(1);
	expect(Math.abs((leftBox?.height ?? 0) - (rightBox?.height ?? 0))).toBeLessThan(1);
	expect(Math.abs((leftBox?.y ?? 0) - (rightBox?.y ?? 0))).toBeLessThan(2);

	await closeWorkspaceOverlays(page);
	const all = page.getByRole("button", { name: "Todos", exact: true });
	const characters = page.getByRole("button", { name: "Personagens", exact: true });
	await expect(all).toHaveAttribute("aria-pressed", "true");
	await characters.click();
	await expect(characters).toHaveAttribute("aria-pressed", "true");
	await expect(all).toHaveAttribute("aria-pressed", "false");

	expect(await page.evaluate(() => window.scrollY)).toBe(0);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});


test("World workspace gives 4K space to the canvas and keeps compact desktop to two structural rows", async ({ page }, testInfo) => {
	test.skip(testInfo.project.name === "mobile", "Desktop geometry matrix.");

	await page.setViewportSize({ width: 2560, height: 1440 });
	await page.goto("/mundo");
	const canvas4k = page.getByTestId("world-canvas");
	const stage4k = page.getByTestId("world-workspace-stage");
	const inspector4k = page.locator('#world-workspace-inspector');
	const navigation4k = page.getByTestId("world-workspace-navigation");
	const [canvas4kBox, stage4kBox, inspector4kBox, navigation4kBox] = await Promise.all([
		canvas4k.boundingBox(),
		stage4k.boundingBox(),
		inspector4k.boundingBox(),
		navigation4k.boundingBox(),
	]);
	expect(canvas4kBox).not.toBeNull();
	expect(stage4kBox).not.toBeNull();
	expect(inspector4kBox).not.toBeNull();
	expect(navigation4kBox).not.toBeNull();
	expect(canvas4kBox?.width ?? 0).toBeGreaterThan(2200);
	expect(stage4kBox?.width ?? 0).toBeGreaterThan(2500);
	expect(inspector4kBox?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(520);
	expect(navigation4kBox?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(270);

	await page.setViewportSize({ width: 1366, height: 768 });
	await page.reload();
	const workspaceBar = page.locator("[data-world-workspace-bar]");
	const filterRail = page.getByTestId("world-filter-rail");
	const canvasCompact = page.getByTestId("world-canvas");
	await expect(workspaceBar).toBeVisible();
	await expect(filterRail).toBeVisible();
	const [barBox, compactCanvasBox, filterBox] = await Promise.all([
		workspaceBar.boundingBox(),
		canvasCompact.boundingBox(),
		filterRail.boundingBox(),
	]);
	expect(barBox).not.toBeNull();
	expect(compactCanvasBox).not.toBeNull();
	expect(filterBox).not.toBeNull();
	expect(barBox?.height ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(104);
	expect(filterBox?.y ?? Number.NEGATIVE_INFINITY).toBeGreaterThanOrEqual(compactCanvasBox?.y ?? 0);
	expect((filterBox?.y ?? 0) + (filterBox?.height ?? 0)).toBeLessThanOrEqual(
		(compactCanvasBox?.y ?? 0) + 110,
	);
	expect(await filterRail.evaluate((element) => element.closest('[data-testid="world-canvas"]') !== null)).toBeTruthy();
	expect(await page.evaluate(() => window.scrollY)).toBe(0);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});
