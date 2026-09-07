import { expect, test } from "@playwright/test";

test("home and archive work without cloud secrets", async ({ page }) => {
	await page.goto("/");
	await expect(page.getByRole("heading", { level: 1 })).toContainText(
		"Rolamos dados.",
	);
	await page.getByRole("link", { name: "Explorar as sessões" }).click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"As histórias até aqui",
	);
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= innerWidth,
		),
	).toBeTruthy();
});

test("home uses the supported screen canvas without layout waste or overlap", async ({
	page,
}) => {
	await page.goto("/");
	const viewport = page.viewportSize();
	expect(viewport).not.toBeNull();
	if (!viewport) return;

	const geometry = await page.evaluate(() => {
		const header = document.querySelector<HTMLElement>(".site-header");
		const brand = document.querySelector<HTMLElement>(".brand");
		const actions = document.querySelector<HTMLElement>(".header-actions");
		const home = document.querySelector<HTMLElement>("main > div");
		const hero = document.querySelector<HTMLElement>(
			'section[aria-labelledby="home-title"]',
		);
		const intro = hero?.children.item(0) as HTMLElement | null;
		const feature = hero?.children.item(1) as HTMLElement | null;
		const memoriesTitle = document.getElementById("memories-title");
		if (!header || !brand || !actions || !home || !hero || !intro || !feature) {
			throw new Error("Home geometry contract is incomplete");
		}
		return {
			overflow: document.documentElement.scrollWidth > innerWidth,
			header: header.getBoundingClientRect().toJSON(),
			brand: brand.getBoundingClientRect().toJSON(),
			actions: actions.getBoundingClientRect().toJSON(),
			home: home.getBoundingClientRect().toJSON(),
			hero: hero.getBoundingClientRect().toJSON(),
			intro: intro.getBoundingClientRect().toJSON(),
			feature: feature.getBoundingClientRect().toJSON(),
			memoriesTop: memoriesTitle?.getBoundingClientRect().top ?? null,
		};
	});

	expect(geometry.overflow).toBeFalsy();
	const expectedShellWidth = Math.min(viewport.width, 2160);
	expect(Math.abs(geometry.header.width - expectedShellWidth)).toBeLessThanOrEqual(2);
	expect(Math.abs(geometry.home.width - expectedShellWidth)).toBeLessThanOrEqual(2);
	expect(geometry.brand.right).toBeLessThan(geometry.actions.left);
	expect(Math.abs(geometry.brand.y - geometry.actions.y)).toBeLessThan(16);

	const gutter = geometry.hero.left - geometry.home.left;
	expect(gutter).toBeGreaterThanOrEqual(19);
	expect(gutter).toBeLessThanOrEqual(73);

	if (viewport.width >= 980) {
		expect(geometry.intro.right).toBeLessThan(geometry.feature.left);
		expect(geometry.memoriesTop).not.toBeNull();
		expect(geometry.memoriesTop ?? viewport.height).toBeLessThan(viewport.height);
	} else {
		expect(geometry.feature.top).toBeGreaterThanOrEqual(geometry.intro.bottom);
	}
});

test("public shell stays usable at 320px", async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 800 });
	await page.goto("/");

	const navigation = page.getByRole("navigation", { name: "Navegação principal" });
	await expect(navigation).toBeVisible();
	await expect(
		navigation.getByRole("link", { name: "Sessões", exact: true }),
	).toBeVisible();
	await expect(navigation.getByRole("link", { name: "Início" })).toHaveCount(0);
	await expect(page.getByRole("switch", { name: "Modo escuro" })).toBeVisible();
	await expect(page.getByText("Aparência", { exact: true })).toHaveCount(0);
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= innerWidth,
		),
	).toBeTruthy();

	await page.keyboard.press("Tab");
	await expect(page.getByRole("link", { name: "Pular para o conteúdo" })).toBeFocused();

	await page.goto("/sessoes");
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"As histórias até aqui",
	);
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= innerWidth,
		),
	).toBeTruthy();
});

test("theme follows the system by default and persists explicit toggles", async ({
	page,
}) => {
	await page.emulateMedia({ colorScheme: "dark" });
	await page.goto("/");
	const toggle = page.getByRole("switch", { name: "Modo escuro" });
	const sun = page.locator(".theme-toggle-glyph--sun");
	const moon = page.locator(".theme-toggle-glyph--moon");

	await expect(toggle).toBeVisible();
	await expect(toggle).toHaveAttribute("aria-checked", "true");
	await expect(toggle).toHaveAttribute("title", "Usar tema claro");
	await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
	expect(await page.evaluate(() => localStorage.getItem("tda-theme"))).toBeNull();
	await expect(sun).toHaveCSS("opacity", "1");
	await expect(moon).toHaveCSS("opacity", "0");

	await toggle.click();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
	await expect(toggle).toHaveAttribute("aria-checked", "false");
	await expect(toggle).toHaveAttribute("title", "Usar tema escuro");
	expect(await page.evaluate(() => localStorage.getItem("tda-theme"))).toBe(
		"light",
	);
	await expect(sun).toHaveCSS("opacity", "0");
	await expect(moon).toHaveCSS("opacity", "1");

	await page.reload();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
	await expect(page.getByRole("switch", { name: "Modo escuro" })).toHaveAttribute(
		"aria-checked",
		"false",
	);

	await page.getByRole("switch", { name: "Modo escuro" }).click();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
	await expect(page.getByRole("switch", { name: "Modo escuro" })).toHaveAttribute(
		"aria-checked",
		"true",
	);
	expect(await page.evaluate(() => localStorage.getItem("tda-theme"))).toBe(
		"dark",
	);
});

test("official design tokens and brand variant follow the resolved theme", async ({
	page,
}) => {
	await page.emulateMedia({ colorScheme: "dark" });
	await page.goto("/");

	await expect
		.poll(() =>
			page.evaluate(() =>
				getComputedStyle(document.documentElement)
					.getPropertyValue("--ds-canvas")
					.trim(),
			),
		)
		.toBe("rgb(10, 12, 15)");
	await expect(page.locator(".brand-symbol-image--dark")).toHaveCSS("opacity", "1");
	await expect(page.locator(".brand-symbol-image--light")).toHaveCSS("opacity", "0");

	await page.getByRole("switch", { name: "Modo escuro" }).click();
	await expect
		.poll(() =>
			page.evaluate(() =>
				getComputedStyle(document.documentElement)
					.getPropertyValue("--ds-canvas")
					.trim(),
			),
		)
		.toBe("rgb(243, 239, 231)");
	await expect(page.locator(".brand-symbol-image--dark")).toHaveCSS("opacity", "0");
	await expect(page.locator(".brand-symbol-image--light")).toHaveCSS("opacity", "1");
});

test("reduced motion removes decorative transitions", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto("/");
	const action = page.getByRole("link", { name: "Explorar as sessões" });
	await expect(action).toBeVisible();
	expect(
		await action.evaluate((element) => getComputedStyle(element).transitionDuration),
	).toBe("0s");
	const knob = page.locator(".theme-toggle-knob");
	expect(
		await knob.evaluate((element) => getComputedStyle(element).transitionDuration),
	).toBe("0s");
	expect(
		await page.evaluate(() => getComputedStyle(document.documentElement).transitionDuration),
	).toBe("0s");
});

test("legacy session hashes map to reboot paths", async ({ page }) => {
	await page.goto("/#/sessao/nonexistent/resumo");
	await expect(page).toHaveURL(/\/sessoes\/nonexistent$/);
});

test("not-found state uses the public navigation contract", async ({ page }) => {
	const response = await page.goto("/sessoes/nonexistent");
	expect(response?.status()).toBe(404);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"Esta história não foi encontrada.",
	);
	await expect(page.getByRole("link", { name: "Voltar às sessões" })).toBeVisible();
});

test("unknown and private routes are not exposed", async ({ request }) => {
	expect((await request.get("/api/transcripts")).status()).toBe(404);
	expect((await request.get("/sessoes/nonexistent")).status()).toBe(404);
});
