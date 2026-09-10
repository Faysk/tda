import { expect, test } from "@playwright/test";

async function expectWorkspaceChromeAvailable(page: import("@playwright/test").Page) {
	await expect(
		page.getByRole("heading", { level: 1, name: "Ecos da Jornada", exact: true }),
	).toBeVisible();
	await expect(page.getByRole("button", { name: "Canvas", exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Lista", exact: true })).toBeVisible();
	await expect(page.getByRole("searchbox", { name: "Buscar no mundo" })).toBeVisible();
	await expect(page.getByLabel("Filtrar por relação")).toBeVisible();
	await expect(page.getByRole("group", { name: "Filtrar o grafo" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Reorganizar", exact: true })).toBeVisible();
}

test("World Workspace keeps primary chrome usable while navigation gives space back to the canvas", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto("/mundo");

	const canvas = page.getByTestId("world-canvas");
	await expect(canvas).toBeVisible();
	await expectWorkspaceChromeAvailable(page);

	const initialCanvasWidth = (await canvas.boundingBox())?.width ?? 0;
	await page.getByRole("button", { name: "Recolher navegação do mundo" }).click();
	await expect(page.getByRole("button", { name: "Explorar universo" })).toBeVisible();
	await expectWorkspaceChromeAvailable(page);

	await expect
		.poll(async () => (await canvas.boundingBox())?.width ?? 0)
		.toBeGreaterThan(initialCanvasWidth);
});

test("World Workspace chrome preserves transient view/filter state without creating explicit focus", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto("/mundo");

	await expectWorkspaceChromeAvailable(page);
	await page.getByRole("button", { name: "Personagens", exact: true }).click();
	await expect(page.getByRole("button", { name: "Personagens", exact: true })).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await page.getByRole("button", { name: "Lista", exact: true }).click();
	await expect(page.getByRole("button", { name: "Lista", exact: true })).toHaveAttribute(
		"aria-pressed",
		"true",
	);

	expect(new URL(page.url()).searchParams.has("foco")).toBeFalsy();
});
