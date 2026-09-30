import { expect, test, type Locator, type Page } from "@playwright/test";

const globalOverlay =
	'[data-global-loading="off"][aria-busy="true"][aria-label="Carregando"]';

const cases = [
	{
		family: "cinematic",
		link: "Cinematic lenta",
		skeleton: "cinematic",
		heading: "Cinematic Loading E2E Target",
	},
	{
		family: "editorial",
		link: "Editorial lenta",
		skeleton: "editorial-list",
		heading: "Editorial Loading E2E Target",
	},
	{
		family: "workspace",
		link: "Workspace lenta",
		skeleton: "workspace-table",
		heading: "Workspace Loading E2E Target",
	},
	{
		family: "world",
		link: "World lento",
		skeleton: "world-canvas",
		heading: "World Loading E2E Target",
	},
	{
		family: "compact",
		link: "Compact lento",
		skeleton: "compact",
		heading: "Compact Loading E2E Target",
	},
] as const;

const responsiveViewports = [
	{ name: "mobile-min", width: 320, height: 800 },
	{ name: "mobile-target", width: 390, height: 844 },
	{ name: "laptop", width: 1366, height: 768 },
	{ name: "desktop", width: 1920, height: 1080 },
	{
		name: "desktop-200-percent-equivalent",
		width: 960,
		height: 540,
	},
] as const;

async function expectNoHorizontalOverflow(page: Page) {
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth + 1,
		),
	).toBe(true);
}

async function beginSlowNavigation(
	page: Page,
	entry: (typeof cases)[number],
) {
	await page.goto("/e2e-fixtures/route-loading");
	const navigation = page.waitForURL(
		new RegExp(`/e2e-fixtures/route-loading/${entry.family}$`, "u"),
	);
	await page.getByRole("link", { name: entry.link }).click({ noWaitAfter: true });

	const skeleton = page.locator(
		`[data-route-skeleton="${entry.skeleton}"][aria-busy="true"]`,
	);
	await expect(skeleton).toBeVisible();
	return { navigation, skeleton };
}

async function expectAccessibleRegionalFallback(
	page: Page,
	skeleton: Locator,
) {
	await expect(skeleton).toHaveAttribute("data-global-loading", "off");
	await expect(page.locator(globalOverlay)).toHaveCount(0);

	const status = page.locator(
		'[data-route-loading-status="true"][role="status"]',
	);
	await expect(status).toHaveCount(1);
	await expect(status).not.toBeEmpty();
	await expect(skeleton.getByRole("status")).toHaveCount(0);

	const decorativeBlocks = skeleton.locator('[data-skeleton-block="true"]');
	expect(await decorativeBlocks.count()).toBeGreaterThan(0);
	await expect(decorativeBlocks.first()).toHaveAttribute("aria-hidden", "true");

	await expect(page.locator(".brand")).toBeVisible();
	await expect(page.locator(".account-menu-trigger")).toBeVisible();
	await expectNoHorizontalOverflow(page);
}

for (const entry of cases) {
	test(`${entry.family} route loading keeps shared chrome and stays regional`, async ({
		page,
	}) => {
		const { navigation, skeleton } = await beginSlowNavigation(page, entry);
		await expectAccessibleRegionalFallback(page, skeleton);

		const accountTrigger = page.locator(".account-menu-trigger");
		await accountTrigger.focus();
		await expect(accountTrigger).toBeFocused();

		await navigation;
		await expect(page.getByRole("heading", { name: entry.heading })).toBeVisible();
		await expect(
			page.locator(`[data-route-skeleton="${entry.skeleton}"]`),
		).toHaveCount(0);
	});
}

test("editorial route skeleton stays usable across the canonical responsive matrix", async ({
	page,
}) => {
	test.setTimeout(45_000);
	const editorial = cases.find((entry) => entry.family === "editorial");
	if (!editorial) throw new Error("Editorial route-loading fixture is missing");

	for (const viewport of responsiveViewports) {
		await page.setViewportSize({
			width: viewport.width,
			height: viewport.height,
		});
		const { navigation, skeleton } = await beginSlowNavigation(page, editorial);
		await expectAccessibleRegionalFallback(page, skeleton);

		const box = await skeleton.boundingBox();
		expect(box, viewport.name).not.toBeNull();
		if (box) {
			expect(box.width, viewport.name).toBeLessThanOrEqual(viewport.width + 1);
			expect(box.x, viewport.name).toBeGreaterThanOrEqual(-1);
		}

		await navigation;
		await expect(page.getByRole("heading", { name: editorial.heading })).toBeVisible();
		await expectNoHorizontalOverflow(page);
	}
});

test("route skeletons use semantic theme roles in dark and light modes", async ({
	page,
}) => {
	const editorial = cases.find((entry) => entry.family === "editorial");
	if (!editorial) throw new Error("Editorial route-loading fixture is missing");
	const editorialLink = editorial.link;

	async function sample(theme: "dark" | "light") {
		await page.goto("/e2e-fixtures/route-loading");
		await page.evaluate((value) => localStorage.setItem("tda-theme", value), theme);
		await page.reload();

		const navigation = page.waitForURL(
			/\/e2e-fixtures\/route-loading\/editorial$/u,
		);
		await page
			.getByRole("link", { name: editorialLink })
			.click({ noWaitAfter: true });

		const skeleton = page.locator(
			'[data-route-skeleton="editorial-list"][aria-busy="true"]',
		);
		await expect(skeleton).toBeVisible();
		const block = skeleton.locator('[data-skeleton-block="true"]').first();
		await expect(block).toBeVisible();
		const visual = await block.evaluate(
			(node) => getComputedStyle(node).backgroundImage,
		);
		await navigation;
		return visual;
	}

	const dark = await sample("dark");
	const light = await sample("light");
	expect(light).not.toBe(dark);
});

test("route skeletons remove decorative shimmer with reduced motion", async ({
	page,
}) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	const editorial = cases.find((entry) => entry.family === "editorial");
	if (!editorial) throw new Error("Editorial route-loading fixture is missing");

	const { navigation, skeleton } = await beginSlowNavigation(page, editorial);
	const block = skeleton.locator('[data-skeleton-block="true"]').first();
	await expect(block).toBeVisible();
	expect(await block.evaluate((node) => getComputedStyle(node).animationName)).toBe(
		"none",
	);
	await expect(
		page.locator('[data-route-loading-status="true"][role="status"]'),
	).toHaveCount(1);

	await navigation;
});
