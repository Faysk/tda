import { expect, test, type Page } from "@playwright/test";

const listedLoreSlugs = ["astel", "noah", "pipipi", "seika", "d", "yllith"] as const;

async function expectNoHorizontalOverflow(page: Page) {
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
	);
	expect(overflow).toBeLessThanOrEqual(1);
}

test("curated lore catalogue discovers every listed experience exactly once", async ({
	page,
}) => {
	await page.goto("/lore");

	for (const slug of listedLoreSlugs) {
		const card = page.locator(`article[data-lore="${slug}"]`);
		await expect(card).toHaveCount(1);
		await expect(card.getByRole("link")).toHaveAttribute("href", `/lore/${slug}`);
	}

	for (const slug of ["d", "yllith"] as const) {
		const card = page.locator(`article[data-lore="${slug}"]`);
		await expect(card).toHaveAttribute("data-lore-campaign", "standalone");
		await expect(card).not.toContainText("Passos Retomados");
		await expect(card).not.toContainText("antes-que-seja-tarde");
		await expect(card).not.toContainText("Crônicas da Mesa");
		const image = card.locator("img").first();
		await expect(image).toBeVisible();
		await expect.poll(() =>
			image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0),
		).toBe(true);
	}
});

test("D and Yllith keep standalone canonicals while becoming discoverable", async ({
	page,
}) => {
	for (const slug of ["d", "yllith"] as const) {
		await page.goto(`/lore/${slug}`, { waitUntil: "domcontentloaded" });
		await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
			"href",
			`https://dnd.faysk.dev/lore/${slug}`,
		);
		await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
			"content",
			/noindex/u,
		);
	}
});

test("catalogue preserves narrow-screen flow with the additional curated lore", async ({
	page,
}) => {
	for (const viewport of [
		{ width: 320, height: 800 },
		{ width: 390, height: 844 },
		{ width: 960, height: 540 },
	]) {
		await page.setViewportSize(viewport);
		await page.goto("/lore");
		await expect(page.locator('article[data-lore="d"]')).toBeVisible();
		await expect(page.locator('article[data-lore="yllith"]')).toBeVisible();
		await expectNoHorizontalOverflow(page);
	}
});

test("lore catalogue exposes multiple stories early and every card is keyboard reachable", async ({
	page,
}) => {
	for (const viewport of [
		{ width: 320, height: 800 },
		{ width: 390, height: 844 },
		{ width: 683, height: 384 },
		{ width: 1366, height: 768 },
	]) {
		await page.setViewportSize(viewport);
		await page.goto("/lore");

		const cards = page.locator("article[data-lore]");
		await expect(cards).toHaveCount(listedLoreSlugs.length);
		const first = await cards.nth(0).boundingBox();
		const second = await cards.nth(1).boundingBox();
		expect(first).not.toBeNull();
		expect(second).not.toBeNull();
		expect(first?.height ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(460);

		if (viewport.width === 320 || viewport.width === 390 || viewport.width >= 1000) {
			expect(
				second?.y ?? Number.POSITIVE_INFINITY,
				`${viewport.width}px: another story should be discoverable before the first viewport ends`,
			).toBeLessThan(viewport.height);
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

test("catalogue grid remains useful with one, four and many stories", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1366, height: 768 });

	for (const visibleCount of [1, 4, listedLoreSlugs.length]) {
		await page.goto("/lore");
		const cards = page.locator("article[data-lore]");
		await expect(cards).toHaveCount(listedLoreSlugs.length);
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

test("long catalogue labels and titles reflow without hiding the action", async ({
	page,
}) => {
	for (const viewport of [
		{ width: 320, height: 800 },
		{ width: 1366, height: 768 },
	]) {
		await page.setViewportSize(viewport);
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
