import { expect, test, type Locator, type Page } from "@playwright/test";

async function expectBelowFloatingChrome(page: Page, target: Locator) {
	await expect(target).toBeVisible();
	const [brandBox, accountBox, targetBox] = await Promise.all([
		page.locator(".brand").boundingBox(),
		page.locator(".account-menu-trigger").boundingBox(),
		target.boundingBox(),
	]);
	expect(brandBox).not.toBeNull();
	expect(accountBox).not.toBeNull();
	expect(targetBox).not.toBeNull();
	const chromeBottom = Math.max(
		(brandBox?.y ?? 0) + (brandBox?.height ?? 0),
		(accountBox?.y ?? 0) + (accountBox?.height ?? 0),
	);
	expect(targetBox?.y ?? -1).toBeGreaterThanOrEqual(chromeBottom + 4);
}

test("world surfaces share campaign-scoped desktop contextual navigation", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 1000 });
	await page.goto("/campanhas/cronicas-da-mesa/mundo");
	await expect(
		page.getByRole("navigation", { name: "Explorar o universo da campanha" }).first(),
	).toBeVisible();

	const worldLink = page.getByRole("link", { name: /Ecos da Jornada/ }).first();
	await expect(worldLink).toHaveAttribute("aria-current", "page");
	await expect(worldLink).toHaveAttribute(
		"href",
		"/campanhas/cronicas-da-mesa/mundo",
	);

	const charactersLink = page.getByRole("link", { name: /Personagens/ }).first();
	await expect(charactersLink).toHaveAttribute(
		"href",
		"/campanhas/cronicas-da-mesa/personagens",
	);
	await charactersLink.click();
	await expect(page).toHaveURL(/\/campanhas\/cronicas-da-mesa\/personagens$/);
	await expect(page.getByRole("heading", { level: 1, name: "Personagens" })).toBeVisible();
	const context = page.getByRole("navigation", { name: "Contexto de exploração" });
	await expect(context.getByRole("link", { name: "Mundo" })).toHaveAttribute(
		"href",
		"/campanhas/cronicas-da-mesa/mundo",
	);
});

test("universe navigation becomes a non-reserving overlay drawer at the 320px minimum", async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 800 });
	await page.goto("/campanhas/cronicas-da-mesa/mundo");
	await expect(page.getByRole("button", { name: "Explorar universo" })).toBeVisible();
	const stage = page.getByTestId("world-workspace-stage");
	const before = await stage.boundingBox();

	await page.getByRole("button", { name: "Explorar universo" }).click();
	await expect(page.getByTestId("world-workspace-navigation")).toBeVisible();
	await expect(
		page.getByRole("navigation", { name: "Explorar o universo da campanha" }),
	).toBeVisible();
	const open = await stage.boundingBox();
	expect(Math.abs((open?.width ?? 0) - (before?.width ?? 0))).toBeLessThan(2);

	const placesLink = page.getByRole("link", { name: /Lugares/ }).last();
	await expect(placesLink).toHaveAttribute(
		"href",
		"/campanhas/cronicas-da-mesa/lugares",
	);
	await placesLink.click();
	await expect(page).toHaveURL(/\/campanhas\/cronicas-da-mesa\/lugares$/);
	await expect(page.getByRole("heading", { level: 1, name: "Lugares" })).toBeVisible();
	expect(
		await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
	).toBeTruthy();
});

test("lore indexes use the central public metadata contract", async ({ page }) => {
	await page.goto("/personagens");
	await expect(page).toHaveTitle(/Personagens/);
	await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
		"content",
		"Personagens",
	);
	await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
		"content",
		"https://dnd.faysk.dev/personagens",
	);
	await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
		"content",
		"https://dnd.faysk.dev/og/default",
	);
	await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
		"href",
		"https://dnd.faysk.dev/personagens",
	);
});

test("catalogue shell keeps expanded and collapsed desktop navigation below floating chrome", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 1000 });
	await page.goto("/personagens");

	await expectBelowFloatingChrome(
		page,
		page.getByText("Arquivo vivo", { exact: true }).first(),
	);

	await page.getByRole("button", { name: "Recolher navegação do mundo" }).click();
	await expectBelowFloatingChrome(
		page,
		page
			.getByRole("navigation", { name: "Explorar o universo da campanha" })
			.getByRole("link", { name: "Ecos da Jornada" }),
	);
});

test("catalogue mobile bar owns its hit area at 390px and 320px", async ({ page }) => {
	for (const viewport of [
		{ width: 390, height: 844 },
		{ width: 320, height: 800 },
	]) {
		await page.setViewportSize(viewport);
		await page.goto("/personagens");

		const trigger = page.getByRole("button", { name: "Explorar universo" });
		await expectBelowFloatingChrome(page, trigger);
		const mobileBar = trigger.locator("xpath=..");
		await expectBelowFloatingChrome(page, mobileBar.locator(":scope > span").last());

		const before = page.url();
		await trigger.click();
		await expect(
			page.getByRole("dialog", { name: "Navegação do universo da campanha" }),
		).toBeVisible();
		expect(page.url()).toBe(before);
		await expect(
			page.getByRole("link", { name: /Voltar ao início/ }).last(),
		).toBeVisible();
		await page.getByRole("button", { name: "Fechar navegação" }).click();
		await expect(
			page.getByRole("dialog", { name: "Navegação do universo da campanha" }),
		).toBeHidden();

		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
		).toBeTruthy();
	}
});

test("catalogue profile context clears floating chrome across supported viewports", async ({ page }) => {
	for (const viewport of [
		{ width: 320, height: 800 },
		{ width: 390, height: 844 },
		{ width: 683, height: 384 },
		{ width: 1440, height: 1000 },
	]) {
		await page.setViewportSize(viewport);
		await page.goto("/campanhas/cronicas-da-mesa/personagens/dandelion");

		const context = page.getByRole("navigation", { name: "Contexto de exploração" });
		await expectBelowFloatingChrome(page, context);
		await expect(context.getByRole("link", { name: "Mundo" })).toHaveAttribute(
			"href",
			"/campanhas/cronicas-da-mesa/mundo",
		);
		await expect(context.getByRole("link", { name: "Personagens" })).toHaveAttribute(
			"href",
			"/campanhas/cronicas-da-mesa/personagens",
		);
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
		).toBeTruthy();
	}
});

test("global menu and universe drawer remain independently recoverable on mobile", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/personagens");

	const globalTrigger = page.getByRole("button", { name: "Abrir menu global" });
	await globalTrigger.click();
	await expect(
		page.getByRole("region", { name: "Navegação, conta e aparência" }),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(globalTrigger).toHaveAttribute("aria-expanded", "false");

	await page.getByRole("button", { name: "Explorar universo" }).click();
	await expect(
		page.getByRole("dialog", { name: "Navegação do universo da campanha" }),
	).toBeVisible();
	await expect(
		page.getByRole("link", { name: /Voltar ao início/ }).last(),
	).toBeVisible();
	await page.getByRole("button", { name: "Fechar navegação" }).click();
	await expect(
		page.getByRole("button", { name: "Explorar universo" }),
	).toBeVisible();
});

test("catalogue shell reflows at the governed 200 percent zoom proxy", async ({ page }) => {
	await page.setViewportSize({ width: 683, height: 384 });
	await page.goto("/personagens");

	await expectBelowFloatingChrome(
		page,
		page.getByRole("button", { name: "Explorar universo" }),
	);
	expect(
		await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
	).toBeTruthy();
});
