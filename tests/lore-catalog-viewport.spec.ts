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

async function expectFollowsWithoutOverlap(
	upper: Locator,
	lower: Locator,
	label: string,
) {
	const [upperBox, lowerBox] = await Promise.all([
		upper.boundingBox(),
		lower.boundingBox(),
	]);
	expect(upperBox, `${label} upper element should have layout geometry`).not.toBeNull();
	expect(lowerBox, `${label} lower element should have layout geometry`).not.toBeNull();
	if (!upperBox || !lowerBox) return;
	expect(
		lowerBox.y,
		`${label} elements should preserve document flow without overlap`,
	).toBeGreaterThanOrEqual(upperBox.y + upperBox.height - 1);
}

async function expectFirstStoryArtworkDecoded(page: Page) {
	const artwork = page.locator(`${FIRST_STORY} img`).first();
	await expect(artwork).toBeVisible();
	await expect
		.poll(
			() =>
				artwork.evaluate((element) => {
					const image = element as HTMLImageElement;
					return image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
				}),
			{ message: "first story artwork should decode before visual acceptance" },
		)
		.toBe(true);
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
		await expectFirstStoryArtworkDecoded(page);

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

test("lore catalogue keeps 320px and the canonical 200% zoom proxy scrollable without overlap or overflow", async ({
	page,
}) => {
	for (const scenario of [
		{ name: "320px", viewport: { width: 320, height: 800 } },
		// docs/design-system/ux-hierarchy.md standardizes 683x384 as the
		// automated geometry proxy for 200% browser zoom.
		{ name: "zoom-200", viewport: { width: 683, height: 384 } },
	] as const) {
		await page.setViewportSize(scenario.viewport);
		await page.goto("/lore");
		await expectNoHorizontalOverflow(page);

		const heroTitle = page.getByRole("heading", {
			level: 1,
			name: "Histórias que ganharam outro palco.",
		});
		const hero = heroTitle.locator("..");
		const card = page.locator(FIRST_STORY);
		const storyTitle = card.getByRole("heading", {
			level: 2,
			name: "Antes da Voz",
		});
		const action = card.getByText("Começar a história", {
			exact: false,
		});
		await expectFollowsWithoutOverlap(hero, card, `${scenario.name} intro/card`);
		await expectFollowsWithoutOverlap(
			storyTitle,
			action,
			`${scenario.name} title/action`,
		);

		const scrollState = await page.evaluate(() => {
			const root = document.scrollingElement;
			return {
				overflowY: getComputedStyle(document.documentElement).overflowY,
				canScroll: Boolean(root && root.scrollHeight > root.clientHeight),
			};
		});
		expect(scrollState.overflowY).not.toBe("hidden");
		expect(scrollState.canScroll, `${scenario.name} should preserve natural document scrolling`).toBe(true);

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
		await expectFirstStoryArtworkDecoded(page);
		await page.screenshot({
			path: testInfo.outputPath(`lore-catalog-${receipt.name}.png`),
			fullPage: false,
		});
	}
});


test("campaign metadata and Seika artwork survive long names at desktop, mobile and the 200% zoom proxy", async ({
	page,
}) => {
	const longCampaignName =
		"Antes que seja tarde — As histórias que ainda cabem numa noite muito longa";

	for (const scenario of [
		{ name: "desktop", viewport: { width: 1920, height: 1080 } },
		{ name: "mobile", viewport: { width: 390, height: 844 } },
		{ name: "zoom-200", viewport: { width: 683, height: 384 } },
	] as const) {
		await page.setViewportSize(scenario.viewport);
		await page.goto("/lore");

		const card = page.locator('article[data-lore="seika"]');
		await card.scrollIntoViewIfNeeded();
		await expect(card).toBeVisible();

		const artwork = card.locator("img").first();
		await expect(artwork).toBeAttached();
		await expect
			.poll(() =>
				artwork.evaluate((node) => {
					const image = node as HTMLImageElement;
					return image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
				}),
			)
			.toBe(true);

		const metadata = card.locator("span").first();
		await metadata.evaluate(
			(node, campaignName) => {
				node.textContent = `${campaignName} · Seika`;
				node.closest("article")?.setAttribute(
					"data-lore-campaign",
					"antes-que-seja-tarde",
				);
			},
			longCampaignName,
		);

		await expect(metadata).toContainText(longCampaignName);
		await expect(card).toHaveAttribute(
			"data-lore-campaign",
			"antes-que-seja-tarde",
		);
		await expectNoHorizontalOverflow(page);

		const [cardBox, metadataBox] = await Promise.all([
			card.boundingBox(),
			metadata.boundingBox(),
		]);
		expect(cardBox, `${scenario.name} Seika card geometry`).not.toBeNull();
		expect(metadataBox, `${scenario.name} campaign metadata geometry`).not.toBeNull();
		if (cardBox && metadataBox) {
			expect(metadataBox.x).toBeGreaterThanOrEqual(cardBox.x - 1);
			expect(metadataBox.x + metadataBox.width).toBeLessThanOrEqual(
				cardBox.x + cardBox.width + 1,
			);
		}
	}
});
