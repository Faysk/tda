import { expect, test } from "@playwright/test";

async function openAppearance(page: import("@playwright/test").Page) {
	const trigger = page.getByRole("button", { name: "Abrir menu global" });
	await trigger.click();
	const toggle = page.getByRole("switch", { name: "Modo escuro" });
	await expect(toggle).toBeVisible();
	return toggle;
}

test("home and archive work without cloud secrets", async ({ page }) => {
	await page.goto("/");
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"A memória global mais recente vem da campanha B",
	);
	await page.getByRole("button", { name: "Abrir menu global" }).click();
	await page
		.getByRole("navigation", { name: "Navegação principal" })
		.getByRole("link", { name: "Sessões", exact: true })
		.click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"As histórias até aqui",
	);
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= innerWidth,
		),
	).toBeTruthy();
});

test("home aggregates campaigns with scoped links and readable campaign identity", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/");

	const campaignName =
		"Antes que seja tarde — uma campanha com nome deliberadamente comprido";
	await expect(page.getByText(campaignName, { exact: true })).toBeVisible();

	const heroLink = page.getByRole("link", {
		name: "A memória global mais recente vem da campanha B",
	});
	await expect(heroLink).toHaveAttribute(
		"href",
		"/campanhas/antes-que-seja-tarde/sessoes/shared-session",
	);

	await expect(
		page.getByRole("link", { name: /A memória mais recente do arquivo sintético/u }),
	).toHaveAttribute(
		"href",
		"/campanhas/cronicas-da-mesa/sessoes/shared-session",
	);
	await expect(
		page.getByRole("link", { name: /Ver todas as sessões/u }),
	).toHaveAttribute("href", "/campanhas/sessoes");

	const campaignGeometry = await page
		.getByText(campaignName, { exact: true })
		.evaluate((element) => {
			const rect = element.getBoundingClientRect();
			return {
				left: rect.left,
				right: rect.right,
				whiteSpace: getComputedStyle(element).whiteSpace,
			};
		});
	expect(campaignGeometry.left).toBeGreaterThanOrEqual(0);
	expect(campaignGeometry.right).toBeLessThanOrEqual(390);
	expect(campaignGeometry.whiteSpace).toBe("normal");
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= innerWidth,
		),
	).toBeTruthy();
});

test("home cinematic baseline preserves viewport, keyline and readable copy widths", async ({
	page,
}) => {
	const viewports = [
		{
			width: 1920,
			height: 1080,
			heroMin: 640,
			titleMax: 760,
			metaMax: 760,
			summaryMax: 720,
			summaryLines: "3",
			artworkPosition: "center 46%",
		},
		{
			width: 2560,
			height: 1440,
			heroMin: 860,
			titleMax: 900,
			metaMax: 820,
			summaryMax: 820,
			summaryLines: "3",
			artworkPosition: "center 44%",
		},
		{
			width: 390,
			height: 844,
			heroMin: 620,
			titleMax: 760,
			metaMax: 760,
			summaryMax: 720,
			summaryLines: "4",
			artworkPosition: "67% center",
		},
		{
			width: 320,
			height: 800,
			heroMin: 620,
			titleMax: 760,
			metaMax: 760,
			summaryMax: 720,
			summaryLines: "4",
			artworkPosition: "67% center",
		},
	] as const;

	for (const viewport of viewports) {
		await page.setViewportSize({ width: viewport.width, height: viewport.height });
		await page.goto("/");

		const geometry = await page.evaluate(() => {
			const surface = document.querySelector<HTMLElement>(
				'[data-home-surface="cinematic"]',
			);
			const header = document.querySelector<HTMLElement>(".site-header");
			const brand = document.querySelector<HTMLElement>(".brand");
			const actions = document.querySelector<HTMLElement>(".header-actions");
			const hero = document.querySelector<HTMLElement>(
				'section[aria-labelledby="home-title"]',
			);
			const editorial = document.querySelector<HTMLElement>(
				"[data-home-editorial-anchor]",
			);
			const heading = document.getElementById("home-title");
			const memories = document.querySelector<HTMLElement>(
				'section[aria-labelledby="memories-title"]',
			);
			if (
				!surface ||
				!header ||
				!brand ||
				!actions ||
				!hero ||
				!editorial ||
				!heading ||
				!memories
			) {
				throw new Error("Home cinematic geometry contract is incomplete");
			}

			const surfaceStyle = getComputedStyle(surface);
			const editorialStyle = getComputedStyle(editorial);
			return {
				overflow: document.documentElement.scrollWidth > innerWidth,
				header: header.getBoundingClientRect().toJSON(),
				brand: brand.getBoundingClientRect().toJSON(),
				actions: actions.getBoundingClientRect().toJSON(),
				surface: surface.getBoundingClientRect().toJSON(),
				hero: hero.getBoundingClientRect().toJSON(),
				editorial: editorial.getBoundingClientRect().toJSON(),
				heading: heading.getBoundingClientRect().toJSON(),
				memories: memories.getBoundingClientRect().toJSON(),
				heroMin: Number.parseFloat(
					surfaceStyle.getPropertyValue("--home-hero-min-block"),
				),
				titleMax: Number.parseFloat(
					surfaceStyle.getPropertyValue("--home-editorial-title-max"),
				),
				metaMax: Number.parseFloat(
					surfaceStyle.getPropertyValue("--home-editorial-meta-max"),
				),
				summaryMax: Number.parseFloat(
					surfaceStyle.getPropertyValue("--home-editorial-summary-max"),
				),
				summaryLines: surfaceStyle
					.getPropertyValue("--home-summary-lines")
					.trim(),
				artworkPosition: surfaceStyle
					.getPropertyValue("--home-artwork-position")
					.trim(),
				paddingLeft: Number.parseFloat(editorialStyle.paddingLeft),
				paddingRight: Number.parseFloat(editorialStyle.paddingRight),
			};
		});

		expect(geometry.overflow).toBeFalsy();
		expect(Math.abs(geometry.header.height)).toBeLessThanOrEqual(1);
		expect(Math.abs(geometry.surface.top)).toBeLessThanOrEqual(1);
		expect(Math.abs(geometry.hero.top)).toBeLessThanOrEqual(1);
		expect(Math.abs(geometry.surface.width - viewport.width)).toBeLessThanOrEqual(2);
		expect(Math.abs(geometry.hero.width - viewport.width)).toBeLessThanOrEqual(2);
		const expectedEditorialWidth = Math.min(viewport.width, 2160);
		const expectedEditorialLeft = (viewport.width - expectedEditorialWidth) / 2;
		expect(
			Math.abs(geometry.editorial.width - expectedEditorialWidth),
		).toBeLessThanOrEqual(2);
		expect(
			Math.abs(geometry.editorial.left - expectedEditorialLeft),
		).toBeLessThanOrEqual(2);
		expect(geometry.hero.height).toBeGreaterThanOrEqual(
			Math.max(viewport.height, viewport.heroMin) - 2,
		);
		expect(geometry.brand.right).toBeLessThan(geometry.actions.left);
		expect(geometry.brand.left).toBeGreaterThanOrEqual(-1);
		expect(geometry.actions.right).toBeLessThanOrEqual(viewport.width + 1);
		expect(geometry.heading.top).toBeGreaterThanOrEqual(geometry.hero.top);
		expect(geometry.heading.bottom).toBeLessThanOrEqual(geometry.hero.bottom);
		expect(geometry.memories.top).toBeGreaterThanOrEqual(geometry.hero.bottom - 2);

		const expectedGutter = Math.min(72, Math.max(20, viewport.width * 0.035));
		expect(Math.abs(geometry.paddingLeft - expectedGutter)).toBeLessThanOrEqual(1.5);
		expect(Math.abs(geometry.paddingRight - expectedGutter)).toBeLessThanOrEqual(1.5);

		expect(geometry.heroMin).toBe(viewport.heroMin);
		expect(geometry.titleMax).toBe(viewport.titleMax);
		expect(geometry.metaMax).toBe(viewport.metaMax);
		expect(geometry.summaryMax).toBe(viewport.summaryMax);
		expect(geometry.summaryLines).toBe(viewport.summaryLines);
		expect(geometry.artworkPosition).toBe(viewport.artworkPosition);

		const overlaps = (
			a: { left: number; right: number; top: number; bottom: number },
			b: { left: number; right: number; top: number; bottom: number },
		) =>
			a.left < b.right &&
			a.right > b.left &&
			a.top < b.bottom &&
			a.bottom > b.top;
		expect(overlaps(geometry.heading, geometry.brand)).toBeFalsy();
		expect(overlaps(geometry.heading, geometry.actions)).toBeFalsy();
	}
});

test("public shell stays usable at 320px", async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 800 });
	await page.goto("/");

	const launcher = page.getByRole("button", { name: "Abrir menu global" });
	await expect(launcher).toBeVisible();
	const account = page.getByRole("button", { name: "Abrir menu global" });
	await expect(account).toBeVisible();
	await expect(page.getByRole("switch", { name: "Modo escuro" })).toHaveCount(0);
	await expect(page.getByText("Aparência", { exact: true })).toHaveCount(0);

	await page.keyboard.press("Tab");
	await expect(page.getByRole("link", { name: "Pular para o conteúdo" })).toBeFocused();

	await account.click();
	await expect(page.getByText("Aparência", { exact: true })).toBeVisible();
	await expect(page.getByRole("switch", { name: "Modo escuro" })).toBeVisible();
	await page.keyboard.press("Escape");

	await launcher.click();
	const navigation = page.getByRole("navigation", { name: "Navegação principal" });
	await expect(navigation).toBeVisible();
	await expect(
		navigation.getByRole("link", { name: "Sessões", exact: true }),
	).toBeVisible();
	await expect(navigation.getByRole("link", { name: "Início" })).toHaveCount(0);
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= innerWidth,
		),
	).toBeTruthy();

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
	const toggle = await openAppearance(page);
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
	const reloadedToggle = await openAppearance(page);
	await expect(reloadedToggle).toHaveAttribute("aria-checked", "false");

	await reloadedToggle.click();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
	await expect(reloadedToggle).toHaveAttribute("aria-checked", "true");
	expect(await page.evaluate(() => localStorage.getItem("tda-theme"))).toBe(
		"dark",
	);
});

test("light theme keeps the cinematic hero dark and horizontally contained", async ({
	page,
}) => {
	await page.emulateMedia({ colorScheme: "light" });
	await page.goto("/");
	const hero = page.locator('section[aria-labelledby="home-title"]');
	await expect(hero).toBeVisible();
	await expect(hero).toHaveCSS("background-color", "rgb(7, 10, 13)");
	await expect
		.poll(() =>
			page.evaluate(() =>
				getComputedStyle(document.documentElement)
					.getPropertyValue("--ds-canvas")
					.trim(),
			),
		)
		.toBe("rgb(243, 239, 231)");
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= innerWidth,
		),
	).toBeTruthy();
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

	const toggle = await openAppearance(page);
	await toggle.click();
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

test("theme transition has a visible midpoint and coordinated final-candidate timings", async ({
	page,
}) => {
	await page.emulateMedia({ colorScheme: "dark", reducedMotion: "no-preference" });
	await page.goto("/");
	const toggle = await openAppearance(page);
	const track = page.locator(".theme-toggle-track");
	const knob = page.locator(".theme-toggle-knob");
	const glyph = page.locator(".theme-toggle-glyph--sun");

	const themeDuration = await page.evaluate(() =>
		getComputedStyle(document.documentElement)
			.getPropertyValue("--ds-motion-theme")
			.trim(),
	);
	expect(themeDuration).toMatch(/^(?:700ms|0?\.7s)$/);

	const trackDuration = await toggle.evaluate((element) =>
		getComputedStyle(element)
			.getPropertyValue("--theme-toggle-track-duration")
			.trim(),
	);
	expect(trackDuration).toMatch(/^(?:520ms|0?\.52s)$/);

	const knobDuration = await toggle.evaluate((element) =>
		getComputedStyle(element)
			.getPropertyValue("--theme-toggle-knob-duration")
			.trim(),
	);
	expect(knobDuration).toMatch(/^(?:650ms|0?\.65s)$/);

	const glyphDuration = await toggle.evaluate((element) =>
		getComputedStyle(element)
			.getPropertyValue("--theme-toggle-glyph-duration")
			.trim(),
	);
	expect(glyphDuration).toMatch(/^(?:460ms|0?\.46s)$/);

	await expect(track).toHaveCSS("transition-duration", "0.52s, 0.52s, 0.52s");
	await expect(knob).toHaveCSS("transition-duration", "0.65s, 0.14s, 0.52s");
	await expect(glyph).toHaveCSS("transition-duration", "0.46s, 0.46s");

	const startCanvas = await page.evaluate(() =>
		getComputedStyle(document.documentElement).getPropertyValue("--ds-canvas").trim(),
	);
	await toggle.click();
	await page.waitForTimeout(250);
	const midpointCanvas = await page.evaluate(() =>
		getComputedStyle(document.documentElement).getPropertyValue("--ds-canvas").trim(),
	);
	expect(midpointCanvas).not.toBe(startCanvas);
	expect(midpointCanvas).not.toBe("rgb(243, 239, 231)");

	await expect
		.poll(() =>
			page.evaluate(() =>
				getComputedStyle(document.documentElement)
					.getPropertyValue("--ds-canvas")
					.trim(),
			),
		)
		.toBe("rgb(243, 239, 231)");
});

test("reduced motion removes decorative transitions", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto("/");
	await page.getByRole("button", { name: "Abrir menu global" }).click();
	const action = page
		.getByRole("navigation", { name: "Navegação principal" })
		.getByRole("link", { name: "Sessões", exact: true });
	await expect(action).toBeVisible();
	expect(
		await action.evaluate((element) => getComputedStyle(element).transitionDuration),
	).toBe("0s");
	await page.keyboard.press("Escape");
	await openAppearance(page);
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

test("unavailable published session keeps the public recovery navigation contract", async ({
	page,
}) => {
	const response = await page.goto("/sessoes/nonexistent");
	expect(response?.status()).toBe(200);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"Esta sessão está temporariamente indisponível.",
	);
	await expect(page.getByRole("link", { name: "Tentar novamente" })).toHaveAttribute(
		"href",
		"/sessoes/nonexistent",
	);
	await expect(page.getByRole("link", { name: "Voltar às sessões" })).toBeVisible();
});

test("private API routes are not exposed", async ({ request }) => {
	expect((await request.get("/api/transcripts")).status()).toBe(404);
});


test("Lore and Diário inherit the shared page gutter and layout ceiling", async ({
	page,
}) => {
	for (const route of ["/lore", "/diario"] as const) {
		await page.goto(route);
		const geometryTokens = await page.evaluate(() => {
			const styles = getComputedStyle(document.documentElement);
			const layoutMax = Number.parseFloat(styles.getPropertyValue("--ds-layout-max"));
			const probe = document.createElement("div");
			probe.style.cssText =
				"position:fixed;visibility:hidden;width:var(--ds-page-gutter);height:0";
			document.body.append(probe);
			const gutter = probe.getBoundingClientRect().width;
			probe.remove();
			return { gutter, layoutMax };
		});
		expect(geometryTokens.layoutMax).toBe(2160);
		expect(geometryTokens.gutter).toBeGreaterThanOrEqual(20);
		expect(geometryTokens.gutter).toBeLessThanOrEqual(72);
	}
});
