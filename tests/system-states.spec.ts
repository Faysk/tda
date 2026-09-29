import { expect, test, type Page } from "@playwright/test";

const CASES = [
	{ viewport: { width: 320, height: 800 }, theme: "light" },
	{ viewport: { width: 390, height: 844 }, theme: "dark" },
	{ viewport: { width: 1366, height: 768 }, theme: "light" },
	{ viewport: { width: 1920, height: 1080 }, theme: "dark" },
] as const;

async function setTheme(page: Page, theme: "light" | "dark") {
	await page.evaluate((value) => {
		document.documentElement.setAttribute("data-theme", value);
		localStorage.setItem("tda-theme", value);
	}, theme);
	await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

async function expectNoHorizontalOverflow(page: Page) {
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth + 1,
		),
	).toBe(true);
}

async function expectClearOfFloatingChrome(page: Page, selector: string) {
	const [content, brand, trigger] = await Promise.all([
		page.locator(selector).boundingBox(),
		page.locator(".brand").boundingBox(),
		page.locator(".account-menu-trigger").boundingBox(),
	]);

	expect(content).not.toBeNull();
	expect(brand).not.toBeNull();
	expect(trigger).not.toBeNull();
	if (!content || !brand || !trigger) return;

	const overlaps = (
		left: { x: number; y: number; width: number; height: number },
		right: { x: number; y: number; width: number; height: number },
	) =>
		left.x < right.x + right.width &&
		left.x + left.width > right.x &&
		left.y < right.y + right.height &&
		left.y + left.height > right.y;

	expect(overlaps(content, brand)).toBe(false);
	expect(overlaps(content, trigger)).toBe(false);
}

test("global 404 and error states follow the floating-shell reading geometry", async ({ page }) => {
	for (const { viewport, theme } of CASES) {
		await page.setViewportSize(viewport);

		await page.goto("/rota-que-nao-existe-system-state");
		await setTheme(page, theme);
		const notFound = page.locator('[data-system-state="not-found"]');
		await expect(notFound).toBeVisible();
		await expect(notFound).toHaveAttribute("data-layout-family", "editorial");
		await expect(notFound).toHaveAttribute("data-layout-content-role", "reading");
		await expect(
			page.getByRole("heading", { name: "Esta história não foi encontrada." }),
		).toBeVisible();
		const home = page.getByRole("link", { name: "Voltar ao início" });
		await expect(home).toHaveAttribute("href", "/");
		await home.focus();
		await expect(home).toBeFocused();
		await expectClearOfFloatingChrome(page, '[data-system-state="not-found"] h1');
		await expectNoHorizontalOverflow(page);

		await page.goto("/e2e-fixtures/system-states/error");
		await setTheme(page, theme);
		const error = page.locator('[data-system-state="error"]');
		await expect(error).toBeVisible();
		const retry = page.getByRole("button", { name: "Tentar novamente" });
		await expect(retry).toBeVisible();
		await retry.focus();
		await expect(retry).toBeFocused();
		await expect(page.locator('[data-retry-count="global"]')).toHaveText("0");
		await retry.click();
		await expect(page.locator('[data-retry-count="global"]')).toHaveText("1");
		await expect(page.getByRole("button", { name: "Tentar novamente" })).toBeVisible();
		await expectClearOfFloatingChrome(page, '[data-system-state="error"] h1');
		await expectNoHorizontalOverflow(page);
	}
});

test("Lembra loading is sidebar-free and follows the incoming #1084 gallery geometry", async ({ page }) => {
	for (const { viewport, theme } of CASES) {
		await page.setViewportSize(viewport);
		await page.goto("/e2e-fixtures/system-states/lembra-loading");
		await setTheme(page, theme);

		const shell = page.locator('[data-lembra-loading="true"]');
		await expect(shell).toBeVisible();
		await expect(shell).toHaveAttribute("aria-busy", "true");
		await expect(shell.locator("aside")).toHaveCount(0);
		await expect(shell.getByRole("status")).toHaveCount(1);
		await expectNoHorizontalOverflow(page);

		const gallery = shell.locator('[data-lembra-loading-gallery="true"]');
		if (viewport.width === 1366) {
			const box = await gallery.boundingBox();
			expect(box).not.toBeNull();
			expect((box?.width ?? 0) / viewport.width).toBeGreaterThan(0.8);
		}
		if (viewport.width === 1920) {
			const box = await gallery.boundingBox();
			expect(box).not.toBeNull();
			expect(box?.width ?? 0).toBeGreaterThan(1700);
		}

		if (viewport.width >= 1280) {
			const [brand, account, firstNavItem, lastToolbarItem] = await Promise.all([
				page.locator(".brand").boundingBox(),
				page.locator(".account-menu-trigger").boundingBox(),
				shell
					.locator('[data-lembra-loading-nav="true"] > div')
					.first()
					.boundingBox(),
				shell
					.locator('[data-lembra-loading-toolbar="true"] > div')
					.last()
					.boundingBox(),
			]);
			expect(brand).not.toBeNull();
			expect(account).not.toBeNull();
			expect(firstNavItem).not.toBeNull();
			expect(lastToolbarItem).not.toBeNull();
			if (brand && account && firstNavItem && lastToolbarItem) {
				expect(firstNavItem.x).toBeGreaterThanOrEqual(brand.x + brand.width + 4);
				expect(lastToolbarItem.x + lastToolbarItem.width).toBeLessThanOrEqual(account.x - 6);
			}
		}
	}
});

test("Lembra error shares the gallery keyline and retry remains keyboard-operable", async ({ page }) => {
	for (const { viewport, theme } of CASES) {
		await page.setViewportSize(viewport);
		await page.goto("/e2e-fixtures/system-states/lembra-error");
		await setTheme(page, theme);

		const heading = page.getByRole("heading", { name: "O Lembra não carregou." });
		await expect(heading).toBeVisible();
		const retry = page.getByRole("button", { name: "Tentar de novo" });
		await retry.focus();
		await expect(retry).toBeFocused();
		await expect(page.locator('[data-retry-count="lembra"]')).toHaveText("0");
		await retry.click();
		await expect(page.locator('[data-retry-count="lembra"]')).toHaveText("1");
		await expectClearOfFloatingChrome(page, "#lembra-error-title");
		await expectNoHorizontalOverflow(page);

		const errorHeadingBox = await heading.boundingBox();
		await page.goto("/e2e-fixtures/system-states/lembra-loading");
		await setTheme(page, theme);
		const galleryBox = await page
			.locator('[data-lembra-loading-gallery="true"]')
			.boundingBox();
		expect(errorHeadingBox).not.toBeNull();
		expect(galleryBox).not.toBeNull();
		if (errorHeadingBox && galleryBox) {
			expect(Math.abs(errorHeadingBox.x - galleryBox.x)).toBeLessThanOrEqual(1);
		}
	}
});

test("permissions route loading keeps the workbench shell instead of covering it", async ({ page }) => {
	for (const { viewport, theme } of CASES) {
		await page.setViewportSize(viewport);
		await page.goto("/e2e-fixtures/system-states/permissions-loading");
		await setTheme(page, theme);

		const shell = page.locator('[data-permissions-loading="true"]');
		await expect(shell).toBeVisible();
		await expect(shell).toHaveAttribute("data-layout-family", "workspace");
		await expect(shell).toHaveAttribute("data-layout-role", "editorial");
		await expect(page.getByRole("heading", { name: "Permissões" })).toBeVisible();
		await expect(page.getByRole("navigation", { name: "Navegação do Edit" })).toBeVisible();
		const status = page.getByRole("status").filter({ hasText: "Carregando dados de permissões" });
		await expect(status).toBeVisible();
		await expect(page.locator('[data-global-loading="off"][aria-label="Carregando"]')).toHaveCount(0);
		await expectClearOfFloatingChrome(page, '[data-permissions-loading="true"] h1');
		await expectNoHorizontalOverflow(page);
	}
});
