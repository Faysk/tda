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

	const appearance = page.getByRole("radiogroup", { name: "Aparência" });
	await expect(appearance).toBeVisible();
	await expect(appearance.getByRole("radio", { name: "Sistema" })).toBeVisible();
	await expect(appearance.getByRole("radio", { name: "Claro" })).toBeVisible();
	await expect(appearance.getByRole("radio", { name: "Escuro" })).toBeVisible();
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

test("theme follows the system by default and persists explicit preferences", async ({
	page,
}) => {
	await page.emulateMedia({ colorScheme: "dark" });
	await page.goto("/");

	const appearance = page.getByRole("radiogroup", { name: "Aparência" });
	const system = appearance.getByRole("radio", { name: "Sistema" });
	const light = appearance.getByRole("radio", { name: "Claro" });

	await expect(system).toBeChecked();
	await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
	expect(await page.evaluate(() => localStorage.getItem("tda-theme"))).toBeNull();

	await page.getByTitle("Usar tema claro").click();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
	await expect(light).toBeChecked();
	expect(await page.evaluate(() => localStorage.getItem("tda-theme"))).toBe(
		"light",
	);

	await page.reload();
	const reloadedAppearance = page.getByRole("radiogroup", { name: "Aparência" });
	await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
	await expect(
		reloadedAppearance.getByRole("radio", { name: "Claro" }),
	).toBeChecked();

	await page.getByTitle("Usar tema escuro").click();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
	expect(await page.evaluate(() => localStorage.getItem("tda-theme"))).toBe(
		"dark",
	);

	await page.getByTitle("Seguir o tema do sistema").click();
	await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
	await expect(
		reloadedAppearance.getByRole("radio", { name: "Sistema" }),
	).toBeChecked();
	expect(await page.evaluate(() => localStorage.getItem("tda-theme"))).toBe(
		"system",
	);
});

test("appearance selector supports native radio keyboard navigation", async ({ page }) => {
	await page.goto("/");
	const appearance = page.getByRole("radiogroup", { name: "Aparência" });
	const system = appearance.getByRole("radio", { name: "Sistema" });
	const light = appearance.getByRole("radio", { name: "Claro" });

	await system.focus();
	await page.keyboard.press("ArrowRight");
	await expect(light).toBeChecked();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("official design tokens and brand variant follow the resolved theme", async ({
	page,
}) => {
	await page.emulateMedia({ colorScheme: "dark" });
	await page.goto("/");

	expect(
		await page.evaluate(() =>
			getComputedStyle(document.documentElement)
				.getPropertyValue("--ds-canvas")
				.trim(),
		),
	).toBe("#0a0c0f");
	expect(
		await page.locator(".brand-symbol-image--dark").evaluate((element) =>
			getComputedStyle(element).display,
		),
	).not.toBe("none");
	expect(
		await page.locator(".brand-symbol-image--light").evaluate((element) =>
			getComputedStyle(element).display,
		),
	).toBe("none");

	await page.getByTitle("Usar tema claro").click();
	expect(
		await page.evaluate(() =>
			getComputedStyle(document.documentElement)
				.getPropertyValue("--ds-canvas")
				.trim(),
		),
	).toBe("#f3efe7");
	expect(
		await page.locator(".brand-symbol-image--dark").evaluate((element) =>
			getComputedStyle(element).display,
		),
	).toBe("none");
	expect(
		await page.locator(".brand-symbol-image--light").evaluate((element) =>
			getComputedStyle(element).display,
		),
	).not.toBe("none");
});

test("reduced motion removes decorative transitions", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto("/");
	const action = page.getByRole("link", { name: "Explorar as sessões" });
	await expect(action).toBeVisible();
	expect(
		await action.evaluate((element) => getComputedStyle(element).transitionDuration),
	).toBe("0s");
	const indicator = page.locator(".theme-selector-indicator");
	expect(
		await indicator.evaluate((element) => getComputedStyle(element).transitionDuration),
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
