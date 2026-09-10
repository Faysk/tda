import { expect, test } from "@playwright/test";

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
	expect(
		await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
	).toBeTruthy();
}

test("World Explorer renders the demo graph and keeps inspection local", async ({ page }) => {
	await page.goto("/mundo");
	await expect(page.getByRole("heading", { name: "Ecos da Jornada" })).toBeVisible();
	await expect(page.getByText("Demo · não canônico")).toBeVisible();
	await expect(page.getByTestId("world-canvas")).toBeVisible();
	await expect(page.locator('[data-world-node="astel"]')).toBeVisible();
	await expect(page.locator('[data-world-node="dandelion"]')).toBeVisible();

	const astel = page.locator('[data-world-node="astel"]');
	await astel.click();
	await expect(page.getByRole("heading", { name: "Astel" })).toBeVisible();
	await expect(page).toHaveURL(/\/mundo$/);
	await expect(page.getByRole("link", { name: /Explorar conexões de Astel/ })).toBeVisible();
});

test("World Explorer exposes explicit focus navigation", async ({ page }) => {
	await page.goto("/mundo");
	await page.locator('[data-world-node="astel"]').click();
	await page.getByRole("link", { name: /Explorar conexões de Astel/ }).click();
	await expect(page).toHaveURL(/\/mundo\?foco=astel$/);
	await expect(page.getByText("Conexões de Astel")).toBeVisible();
	await expect(page.getByRole("link", { name: "Voltar à visão geral" })).toBeVisible();
});

test("World Explorer type and relation filters stay functional", async ({ page }) => {
	await page.goto("/mundo");
	await page.getByRole("button", { name: "NPCs" }).click();
	await expect(page.locator('[data-world-node="raven-queen"]')).toBeVisible();
	await expect(page.locator('[data-world-node="astel"]')).toHaveCount(0);
	await page.getByRole("button", { name: "Todos" }).click();

	await page.getByRole("button", { name: "Filtrar por relação" }).click();
	await page.getByRole("option", { name: "Conflito" }).click();
	await expect(page.locator('[data-world-relation="conflict"]')).toHaveCount(1);
});

test("World Explorer search and list mode remain usable", async ({ page }) => {
	await page.goto("/mundo");
	await page.getByRole("searchbox", { name: "Buscar no mundo" }).fill("Astel");
	await expect(page.locator('[data-world-node="astel"]')).toBeVisible();
	await expect(page.locator('[data-world-node="dandelion"]')).toHaveCount(0);
	await page.getByRole("button", { name: "Lista" }).click();
	await expect(page.getByRole("heading", { name: "Relações em lista" })).toBeVisible();
});

test("World Explorer inspector can be resized and collapsed", async ({ page }) => {
	await page.goto("/mundo");
	const resizeHandle = page.getByLabel("Ajustar largura do painel");
	const explorer = page.locator('[data-world-edit-state="view"]');
	const before = await explorer.evaluate((element) =>
		getComputedStyle(element).getPropertyValue("--world-inspector-width"),
	);
	await resizeHandle.focus();
	await page.keyboard.press("ArrowLeft");
	const after = await explorer.evaluate((element) =>
		getComputedStyle(element).getPropertyValue("--world-inspector-width"),
	);
	expect(after).not.toBe(before);
	await page.getByRole("button", { name: "Recolher painel de detalhes" }).click();
	await expect(page.getByRole("button", { name: "Abrir painel de detalhes" })).toBeVisible();
});

test("World Explorer gives the canvas more width when the world rail is collapsed", async ({ page }) => {
	await page.goto("/mundo");
	const canvas = page.getByTestId("world-canvas");
	const before = await canvas.boundingBox();
	await page.getByRole("button", { name: "Recolher navegação do mundo" }).click();
	const after = await canvas.boundingBox();
	expect(after?.width ?? 0).toBeGreaterThan(before?.width ?? 0);
});

test("World Explorer keeps its primary work visible on a 1366x768 first viewport", async ({ page }) => {
	await page.setViewportSize({ width: 1366, height: 768 });
	await page.goto("/mundo");
	const canvas = page.getByTestId("world-canvas");
	const box = await canvas.boundingBox();
	expect(box).not.toBeNull();
	expect(box?.y ?? 9999).toBeLessThan(310);
	expect(box?.height ?? 0).toBeGreaterThanOrEqual(430);
});

test("World Explorer responsive toolbar has no horizontal overflow", async ({ page }) => {
	for (const width of [1366, 1024, 768, 390, 320]) {
		await page.setViewportSize({ width, height: 900 });
		await page.goto("/mundo");
		await expect(page.getByRole("button", { name: "Filtrar por relação" })).toBeVisible();
		await expectNoHorizontalOverflow(page);
	}
});

test("World Explorer custom relation select remains themed across theme changes", async ({ page }) => {
	await page.goto("/mundo");
	const relationTrigger = page.getByRole("button", { name: "Filtrar por relação" });
	const themeToggle = page.getByRole("switch", { name: "Alternar tema" });
	await relationTrigger.click();
	const listbox = page.getByRole("listbox", { name: "Filtrar por relação" });
	await expect(listbox).toBeVisible();
	const firstPaint = await listbox.evaluate((element) => {
		const style = getComputedStyle(element);
		return {
			background: style.backgroundColor,
			borderWidth: style.borderTopWidth,
			borderRadius: style.borderTopLeftRadius,
		};
	});
	expect(firstPaint.background).not.toBe("rgba(0, 0, 0, 0)");
	expect(firstPaint.borderWidth).not.toBe("0px");
	expect(firstPaint.borderRadius).not.toBe("0px");
	await page.keyboard.press("Escape");

	const wasDark = await themeToggle.getAttribute("aria-checked");
	await themeToggle.click();
	await expect(themeToggle).toHaveAttribute("aria-checked", wasDark === "true" ? "false" : "true");
	await page.waitForTimeout(800);

	await relationTrigger.click();
	await expect(listbox).toBeVisible();
	await expect.poll(() => listbox.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(firstPaint.background);

	const nativeRelationSelect = await page.locator("select").evaluateAll((selects) =>
		selects.some((select) =>
			Array.from((select as HTMLSelectElement).options).some((option) => option.text === "Conflito"),
		),
	);
	expect(nativeRelationSelect).toBe(false);
});

test("World Explorer nodes are movable without changing the URL", async ({ page }) => {
	await page.goto("/mundo");
	const astel = page.locator('[data-world-node="astel"]').locator("..");
	const before = await astel.getAttribute("style");
	const box = await astel.boundingBox();
	expect(box).not.toBeNull();
	if (box) {
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 30, { steps: 6 });
		await page.mouse.up();
	}
	await expect.poll(() => astel.getAttribute("style")).not.toBe(before);
	await expect(page).toHaveURL(/\/mundo$/);
});

test("World Explorer collapses the side inspector before it can squeeze intermediate widths", async ({ page }) => {
	await page.setViewportSize({ width: 1024, height: 900 });
	await page.goto("/mundo");
	await expect(page.getByTestId("world-canvas")).toBeVisible();
	await expect(page.getByLabel("Ajustar largura do painel")).toBeHidden();
	await expect(page.getByRole("button", { name: "Filtrar por relação" })).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test("World Explorer stays inside the viewport including the 320px minimum", async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 800 });
	await page.goto("/mundo");
	await expect(page.getByTestId("world-canvas")).toBeVisible();
	await expect(page.getByRole("button", { name: "Todos" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Filtrar por relação" })).toBeVisible();
	await expectNoHorizontalOverflow(page);
});

test("World Explorer preserves public focus semantics while editing remains local", async ({ page }) => {
	await page.goto("/mundo?foco=astel");
	await expect(page.getByText("Conexões de Astel")).toBeVisible();
	await expect(page.getByRole("button", { name: /Editar/ })).toHaveCount(0);
	await page.locator('[data-world-node="dandelion"]').click();
	await expect(page.getByRole("heading", { name: "Dandelion" })).toBeVisible();
	await expect(page).toHaveURL(/\/mundo\?foco=astel$/);
});
