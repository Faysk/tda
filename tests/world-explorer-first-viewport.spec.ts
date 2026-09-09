import { expect, test } from "@playwright/test";

test("World Explorer exposes the graph immediately and gives desktop space back when the rail collapses", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1366, height: 768 });
	await page.goto("/mundo");

	await expect(
		page.getByRole("heading", { level: 1, name: "Ecos da Jornada", exact: true }),
	).toBeVisible();
	const canvas = page.getByTestId("world-canvas");
	await expect(canvas).toBeVisible();

	const initialCanvas = await canvas.boundingBox();
	expect(initialCanvas).not.toBeNull();
	expect(initialCanvas?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(310);
	expect(initialCanvas?.height ?? 0).toBeGreaterThanOrEqual(430);
	const initialWidth = initialCanvas?.width ?? 0;

	const collapse = page.getByRole("button", {
		name: "Recolher navegação do mundo",
	});
	await expect(collapse).toBeVisible();
	await collapse.click();
	await expect(
		page.getByRole("button", { name: "Expandir navegação do mundo" }),
	).toBeVisible();

	// The rail animates through the design-system motion token; assert the settled
	// layout rather than sampling the first frame immediately after the click.
	await expect
		.poll(async () => (await canvas.boundingBox())?.width ?? 0)
		.toBeGreaterThan(initialWidth);

	expect(
		await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
	).toBeTruthy();
});

test("World Explorer keeps mobile navigation, controls and inspector sheet touch-safe", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/mundo");

	await expect(page.getByRole("button", { name: "Explorar universo" })).toBeVisible();
	await expect(page.getByTestId("world-canvas")).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Recolher navegação do mundo" }),
	).toHaveCount(0);

	const detailToggle = page.getByRole("button", { name: "Recolher painel de detalhes" });
	await expect(detailToggle).toBeVisible();
	const detailToggleBox = await detailToggle.boundingBox();
	expect(detailToggleBox?.width ?? 0).toBeGreaterThanOrEqual(44);
	expect(detailToggleBox?.height ?? 0).toBeGreaterThanOrEqual(44);

	const flowControl = page.locator(".react-flow__controls-button").first();
	await expect(flowControl).toBeVisible();
	const flowControlBox = await flowControl.boundingBox();
	expect(flowControlBox?.width ?? 0).toBeGreaterThanOrEqual(44);
	expect(flowControlBox?.height ?? 0).toBeGreaterThanOrEqual(44);

	await detailToggle.click();
	await expect(page.getByRole("button", { name: "Abrir painel de detalhes" })).toBeVisible();

	expect(
		await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
	).toBeTruthy();
});
