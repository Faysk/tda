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


test("lore catalogue exposes multiple stories early and every card is keyboard reachable", async ({
	page,
}) => {
	const listedLoreSlugs = ["astel", "noah", "pipipi", "seika", "d", "yllith"] as const;
	for (const scenario of [
		{ width: 320, height: 800 },
		{ width: 390, height: 844 },
		{ width: 683, height: 384 },
		{ width: 1366, height: 768 },
	] as const) {
		await page.setViewportSize(scenario);
		await page.goto("/lore");

		const cards = page.locator("article[data-lore]");
		await expect(cards).toHaveCount(listedLoreSlugs.length);
		const first = await cards.nth(0).boundingBox();
		const second = await cards.nth(1).boundingBox();
		expect(first).not.toBeNull();
		expect(second).not.toBeNull();
		expect(first?.height ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(460);

		if (scenario.width === 320 || scenario.width === 390 || scenario.width >= 1000) {
			expect(
				second?.y ?? Number.POSITIVE_INFINITY,
				`${scenario.width}px: another story should be discoverable before the first viewport ends`,
			).toBeLessThan(scenario.height);
		}

		for (const slug of listedLoreSlugs) {
			await expect(
				page.locator(`article[data-lore="${slug}"]`).getByRole("heading"),
			).toBeVisible();
		}
		await expectNoHorizontalOverflow(page);
	}

	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/lore");
	const expectedHrefs = new Set<string>(
		listedLoreSlugs.map((slug) => `/lore/${slug}`),
	);
	const reachedHrefs = new Set<string>();
	for (let step = 0; step < 40 && reachedHrefs.size < expectedHrefs.size; step += 1) {
		await page.keyboard.press("Tab");
		const href = await page.evaluate(() =>
			document.activeElement instanceof HTMLAnchorElement
				? document.activeElement.getAttribute("href")
				: null,
		);
		if (href && expectedHrefs.has(href)) reachedHrefs.add(href);
	}
	expect([...reachedHrefs].sort()).toEqual([...expectedHrefs].sort());
});

test("lore catalogue grid remains useful with one, four and many stories", async ({
	page,
}) => {
	const totalStories = 6;
	await page.setViewportSize({ width: 1366, height: 768 });

	for (const visibleCount of [1, 4, totalStories]) {
		await page.goto("/lore");
		const cards = page.locator("article[data-lore]");
		await expect(cards).toHaveCount(totalStories);
		await cards.evaluateAll((nodes, count) => {
			nodes.forEach((node, index) => {
				(node as HTMLElement).hidden = index >= count;
			});
		}, visibleCount);

		const visibleCards = page.locator("article[data-lore]:visible");
		await expect(visibleCards).toHaveCount(visibleCount);
		const boxes = await visibleCards.evaluateAll((nodes) =>
			nodes.map((node) => {
				const box = node.getBoundingClientRect();
				return { x: box.x, width: box.width, height: box.height };
			}),
		);
		expect(boxes.every((box) => box.width >= 300 && box.height <= 460)).toBe(true);
		if (visibleCount === 1) {
			expect(boxes[0]?.width ?? 0).toBeGreaterThan(600);
		} else {
			expect(new Set(boxes.map((box) => Math.round(box.x))).size).toBeGreaterThan(1);
		}
		await expectNoHorizontalOverflow(page);
	}

	await page.goto("/lore");
	await expect(page.locator('[data-lore-catalogue-mode="flat"]')).toHaveCount(1);
	await expect(page.locator('[data-lore-catalogue-mode="grouped"]')).toHaveCount(0);
});

test("long lore catalogue labels and titles reflow without hiding the action", async ({
	page,
}) => {
	for (const scenario of [
		{ width: 320, height: 800 },
		{ width: 1366, height: 768 },
	] as const) {
		await page.setViewportSize(scenario);
		await page.goto("/lore");
		const card = page.locator("article[data-lore]").first();
		const label = card.locator("span").first();
		const heading = card.getByRole("heading");
		await label.evaluate((node) => {
			node.textContent =
				"CampanhaComNomeEditorialExtremamenteLongoSemEspacos · PersonagemComNomeMuitoLongo";
		});
		await heading.evaluate((node) => {
			node.textContent =
				"UmaHistoriaComTituloExtremamenteLongoSemEspacosQuePrecisaContinuarLegivel";
		});

		await expect(heading).toBeVisible();
		await expect(card.getByText("Começar a história")).toBeVisible();
		await expectNoHorizontalOverflow(page);

		const [cardBox, labelBox, headingBox] = await Promise.all([
			card.boundingBox(),
			label.boundingBox(),
			heading.boundingBox(),
		]);
		expect(cardBox).not.toBeNull();
		expect(labelBox).not.toBeNull();
		expect(headingBox).not.toBeNull();
		if (cardBox && labelBox && headingBox) {
			expect(labelBox.x + labelBox.width).toBeLessThanOrEqual(
				cardBox.x + cardBox.width + 1,
			);
			expect(headingBox.x + headingBox.width).toBeLessThanOrEqual(
				cardBox.x + cardBox.width + 1,
			);
		}
	}
});


test("lore catalogue primary story action works with mouse and touch", async ({
	page,
	browser,
}) => {
	await page.setViewportSize({ width: 1366, height: 768 });
	await page.goto("/lore");
	await page.locator('article[data-lore="astel"] a[href="/lore/astel"]').click();
	await expect(page).toHaveURL(/\/lore\/astel$/u);

	const context = await browser.newContext({
		viewport: { width: 390, height: 844 },
		hasTouch: true,
		isMobile: true,
	});
	const touchPage = await context.newPage();
	await touchPage.goto("/lore");
	await touchPage
		.locator('article[data-lore="astel"] a[href="/lore/astel"]')
		.tap();
	await expect(touchPage).toHaveURL(/\/lore\/astel$/u);
	await context.close();
});
