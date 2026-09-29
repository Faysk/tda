import { expect, test, type Page, type TestInfo } from "@playwright/test";

async function expectNoHorizontalOverflow(page: Page) {
	const geometry = await page.evaluate(() => ({
		scrollWidth: document.documentElement.scrollWidth,
		innerWidth: window.innerWidth,
	}));
	expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.innerWidth + 1);
}

async function gotoSurface(page: Page, path: string) {
	const response = await page.goto(path);
	expect(response?.status() ?? 200, path).toBeLessThan(400);
	await expect(page.locator("main").first()).toBeVisible();
	await expectNoHorizontalOverflow(page);
}

async function receipt(page: Page, testInfo: TestInfo, name: string) {
	await page.evaluate(async () => {
		await document.fonts.ready;
	});
	await expectNoHorizontalOverflow(page);
	await page.screenshot({
		path: testInfo.outputPath(`layout-cross-${name}.png`),
		fullPage: false,
	});
}

async function closeWorldOverlays(page: Page) {
	const closeNavigation = page
		.getByRole("button", { name: "Recolher navegação do mundo" })
		.first();
	if (await closeNavigation.isVisible().catch(() => false)) {
		await closeNavigation.click();
	}

	const closeInspector = page.getByRole("button", {
		name: "Recolher painel de detalhes",
	});
	if (await closeInspector.isVisible().catch(() => false)) {
		await closeInspector.click();
	}
}

test("sanitized cross-surface receipts cover the consolidated TDA layout families", async ({
	page,
}, testInfo) => {
	await page.setViewportSize({ width: 1920, height: 1080 });
	await page.addInitScript(() => localStorage.setItem("tda-theme", "dark"));

	await gotoSurface(page, "/");
	await receipt(page, testInfo, "home-baseline");
	await receipt(page, testInfo, "menu-closed");

	const menuTrigger = page.getByRole("button", { name: "Abrir menu global" });
	await menuTrigger.click();
	const menuPanel = page.getByRole("region", {
		name: "Navegação, conta e aparência",
	});
	await expect(menuPanel).toBeVisible();
	await expect(menuPanel).toHaveAttribute("data-view", "root");
	await receipt(page, testInfo, "menu-open");

	const worldDrilldown = menuPanel.getByRole("button", {
		name: "Mundo",
		exact: true,
	});
	await worldDrilldown.click();
	await expect(menuPanel).toHaveAttribute("data-view", "world");
	const backToExplore = menuPanel.getByRole("button", {
		name: "Voltar para Explorar",
		exact: true,
	});
	await expect(backToExplore).toBeFocused();
	await receipt(page, testInfo, "menu-world-drilldown");
	await backToExplore.click();
	await expect(menuPanel).toHaveAttribute("data-view", "root");
	await expect(worldDrilldown).toBeFocused();
	await page.keyboard.press("Escape");

	await gotoSurface(page, "/lembra");
	await expect(page.locator('aside[aria-label="Filtros do Lembra"]')).toHaveCount(0);
	await receipt(page, testInfo, "lembra");

	await gotoSurface(page, "/mundo");
	await closeWorldOverlays(page);
	await receipt(page, testInfo, "world-closed");

	await page.getByRole("button", { name: "Explorar universo" }).click();
	await expect(page.getByTestId("world-workspace-navigation")).toBeVisible();
	await receipt(page, testInfo, "world-left-open");
	await page
		.getByRole("button", { name: "Recolher navegação do mundo" })
		.first()
		.click();

	const openInspector = page.getByRole("button", {
		name: "Abrir painel de detalhes",
	});
	await expect(openInspector).toBeVisible();
	await openInspector.click();
	await expect(page.locator("#world-workspace-inspector")).toBeVisible();
	await receipt(page, testInfo, "world-right-open");

	await gotoSurface(page, "/sessoes");
	await receipt(page, testInfo, "sessions-archive");

	await gotoSurface(
		page,
		"/e2e-fixtures/lore-catalog?kind=personagens&scenario=with-media",
	);
	await expect(page.locator('[data-lore-index="personagens"]')).toBeVisible();
	await receipt(page, testInfo, "world-catalog");

	await gotoSurface(page, "/e2e-fixtures/lore-profile");
	await expect(page.getByRole("heading", { name: "Visão geral" })).toBeVisible();
	await receipt(page, testInfo, "world-profile");

	await gotoSurface(page, "/edit/processamento");
	await expect(page.locator('[data-processing-workspace="true"]')).toBeVisible();
	await receipt(page, testInfo, "workbench-processing");
});
