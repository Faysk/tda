import { expect, test, type Locator, type Page } from "@playwright/test";

const FIRST_STORY = 'article[data-lore="astel"]';

async function expectNoHorizontalOverflow(page: Page) {
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth + 1,
		),
	).toBeTruthy();
}

async function expectInsideViewport(
	locator: Locator,
	viewportHeight: number,
	label: string,
) {
	await expect(locator, `${label} should be visible`).toBeVisible();
	const box = await locator.boundingBox();
	expect(box, `${label} should have layout geometry`).not.toBeNull();
	if (!box) return;
	expect(box.y, `${label} should start inside the first viewport`).toBeGreaterThanOrEqual(0);
	expect(
		box.y + box.height,
		`${label} should finish inside the first viewport`,
	).toBeLessThanOrEqual(viewportHeight + 1);
}

test("lore catalogue exposes the first story identity and action in the first viewport", async ({
	page,
}, testInfo) => {
	for (const scenario of [
		{
			name: "desktop",
			viewport: { width: 1920, height: 1080 },
		},
		{
			name: "mobile",
			viewport: { width: 390, height: 844 },
		},
	] as const) {
		await page.setViewportSize(scenario.viewport);
		await page.emulateMedia({ colorScheme: "dark" });
		await page.goto("/lore");
		await page.evaluate(async () => {
			await document.fonts.ready;
		});

		const heroTitle = page.getByRole("heading", {
			level: 1,
			name: "Histórias que ganharam outro palco.",
		});
		const card = page.locator(FIRST_STORY);
		const storyName = card.locator("span").first();
		const storyTitle = card.getByRole("heading", {
			level: 2,
			name: "Antes da Voz",
		});
		const action = card.getByText("Começar a história", { exact: false });

		await expect(heroTitle).toBeVisible();
		await expectInsideViewport(storyName, scenario.viewport.height, "story name");
		await expectInsideViewport(storyTitle, scenario.viewport.height, "story title");
		await expectInsideViewport(action, scenario.viewport.height, "story action");
		await expectNoHorizontalOverflow(page);

		const heroFontSize = await heroTitle.evaluate((element) =>
			Number.parseFloat(getComputedStyle(element).fontSize),
		);
		expect(heroFontSize).toBeLessThanOrEqual(48);

		await page.screenshot({
			path: testInfo.outputPath(`lore-catalog-${scenario.name}-dark.png`),
			fullPage: false,
		});
	}
});

test("lore catalogue keeps 320px and the 200% zoom layout proxy scrollable without overflow", async ({
	page,
}) => {
	for (const scenario of [
		{ name: "320px", viewport: { width: 320, height: 800 } },
		// Browser zoom reduces the CSS viewport. 960x540 is the 200% layout
		// equivalent of the 1920x1080 acceptance viewport used by #1232.
		{ name: "zoom-200", viewport: { width: 960, height: 540 } },
	] as const) {
		await page.setViewportSize(scenario.viewport);
		await page.goto("/lore");
		await expectNoHorizontalOverflow(page);

		const scrollState = await page.evaluate(() => {
			const root = document.scrollingElement;
			return {
				overflowY: getComputedStyle(document.documentElement).overflowY,
				canScroll: Boolean(root && root.scrollHeight > root.clientHeight),
			};
		});
		expect(scrollState.overflowY).not.toBe("hidden");
		expect(scrollState.canScroll, `${scenario.name} should preserve natural document scrolling`).toBe(true);

		const action = page.locator(FIRST_STORY).getByText("Começar a história", {
			exact: false,
		});
		await action.scrollIntoViewIfNeeded();
		await expect(action).toBeVisible();
		await expectNoHorizontalOverflow(page);
	}
});

test("lore catalogue first story remains keyboard reachable with a visible focus indicator", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/lore");
	const firstStoryLink = page.locator(`${FIRST_STORY} a[href="/lore/astel"]`);

	let reached = false;
	for (let index = 0; index < 12; index += 1) {
		await page.keyboard.press("Tab");
		reached = await firstStoryLink.evaluate(
			(element) => document.activeElement === element,
		);
		if (reached) break;
	}
	expect(reached, "first story link should be reachable by sequential keyboard navigation").toBe(true);
	await expect(firstStoryLink).toBeFocused();

	const outline = await firstStoryLink.evaluate((element) => {
		const style = getComputedStyle(element);
		return {
			style: style.outlineStyle,
			width: Number.parseFloat(style.outlineWidth),
		};
	});
	expect(outline.style).not.toBe("none");
	expect(outline.width).toBeGreaterThan(0);

	await page.keyboard.press("Enter");
	await expect(page).toHaveURL(/\/lore\/astel$/u);
});

test("lore catalogue visual receipts cover light and dark themes at both acceptance viewports", async ({
	page,
}, testInfo) => {
	for (const receipt of [
		{
			name: "desktop-light",
			viewport: { width: 1920, height: 1080 },
			colorScheme: "light" as const,
		},
		{
			name: "desktop-dark",
			viewport: { width: 1920, height: 1080 },
			colorScheme: "dark" as const,
		},
		{
			name: "mobile-light",
			viewport: { width: 390, height: 844 },
			colorScheme: "light" as const,
		},
		{
			name: "mobile-dark",
			viewport: { width: 390, height: 844 },
			colorScheme: "dark" as const,
		},
	] as const) {
		await page.setViewportSize(receipt.viewport);
		await page.emulateMedia({ colorScheme: receipt.colorScheme });
		await page.goto("/lore");
		await page.evaluate(async () => {
			await document.fonts.ready;
		});
		await page.screenshot({
			path: testInfo.outputPath(`lore-catalog-${receipt.name}.png`),
			fullPage: false,
		});
	}
});
