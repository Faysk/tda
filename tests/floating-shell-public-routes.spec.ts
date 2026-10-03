import { expect, test } from "@playwright/test";

const publicRoutes = [
	"/sessoes",
	"/lore",
	"/personagens",
	"/npcs",
	"/lugares",
	"/faccoes",
	"/quests",
	"/musicas",
	"/diario",
	"/lembra",
] as const;

async function expectFirstCriticalContentClear(
	page: import("@playwright/test").Page,
	route: (typeof publicRoutes)[number],
) {
	await page.goto(route);

	const [brandBox, triggerBox] = await Promise.all([
		page.locator(".brand").boundingBox(),
		page.locator(".account-menu-trigger").boundingBox(),
	]);

	const target =
		route === "/lembra"
			? page.getByPlaceholder("Buscar título, descrição, autor ou data...")
			: page.getByRole("heading", { level: 1 }).first();
	await expect(target).toBeVisible();
	const box = await target.boundingBox();
	expect(box).not.toBeNull();
	expect(brandBox).not.toBeNull();
	expect(triggerBox).not.toBeNull();
	if (box && brandBox && triggerBox) {
		const overlaps = (
			left: { x: number; y: number; width: number; height: number },
			right: { x: number; y: number; width: number; height: number },
		) =>
			left.x < right.x + right.width &&
			left.x + left.width > right.x &&
			left.y < right.y + right.height &&
			left.y + left.height > right.y;
		expect(overlaps(box, brandBox)).toBeFalsy();
		expect(overlaps(box, triggerBox)).toBeFalsy();
	}

	const overflow = await page.evaluate(() => ({
		scrollWidth: document.documentElement.scrollWidth,
		clientWidth: document.documentElement.clientWidth,
	}));
	expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

async function sharedKeyline(page: import("@playwright/test").Page) {
	return page.evaluate(() => {
		const styles = getComputedStyle(document.documentElement);
		const layoutMax = Number.parseFloat(styles.getPropertyValue("--ds-layout-max"));
		const probe = document.createElement("div");
		probe.style.cssText =
			"position:fixed;visibility:hidden;width:var(--ds-page-gutter);height:0";
		document.body.append(probe);
		const gutter = probe.getBoundingClientRect().width;
		probe.remove();
		const layoutWidth = Math.min(innerWidth, layoutMax);
		return {
			gutter,
			layoutMax,
			x: Math.max(0, (innerWidth - layoutWidth) / 2) + gutter,
			contentWidth: layoutWidth - gutter * 2,
		};
	});
}

test("floating chrome leaves first critical public content reachable at 320px and 390px", async ({
	page,
}) => {
	for (const viewport of [
		{ width: 320, height: 800 },
		{ width: 390, height: 844 },
	]) {
		await page.setViewportSize(viewport);
		for (const route of publicRoutes) {
			await expectFirstCriticalContentClear(page, route);
		}
	}
});

test("representative public surfaces remain clear at the 200% zoom-equivalent viewport", async ({
	page,
}) => {
	await page.setViewportSize({ width: 683, height: 384 });
	for (const route of ["/sessoes", "/lore", "/diario", "/lembra"] as const) {
		await expectFirstCriticalContentClear(page, route);
	}
});

test("Lore grid and Diário preserve the structural keyline while using distinct content widths", async ({
	page,
}) => {
	for (const viewport of [
		{ width: 1920, height: 1080 },
		{ width: 2560, height: 1440 },
	]) {
		await page.setViewportSize(viewport);

		await page.goto("/lore");
		const loreKeyline = await sharedKeyline(page);
		const loreHeading = await page
			.getByRole("heading", {
				level: 1,
				name: "Histórias que ganharam outro palco.",
			})
			.boundingBox();
		const loreArchive = await page
			.locator("[data-lore-catalogue-mode]")
			.first()
			.boundingBox();
		const loreCard = await page.locator("article[data-lore]").first().boundingBox();
		expect(loreHeading).not.toBeNull();
		expect(loreArchive).not.toBeNull();
		expect(loreCard).not.toBeNull();
		if (loreHeading && loreArchive && loreCard) {
			expect(Math.abs(loreHeading.x - loreKeyline.x)).toBeLessThanOrEqual(2);
			expect(Math.abs(loreArchive.x - loreKeyline.x)).toBeLessThanOrEqual(2);
			expect(loreArchive.width).toBeGreaterThanOrEqual(
				loreKeyline.contentWidth - 3,
			);
			expect(loreCard.width).toBeGreaterThanOrEqual(300);
			expect(loreCard.width).toBeLessThan(loreArchive.width / 2);
		}

		await page.goto("/diario");
		const diaryKeyline = await sharedKeyline(page);
		const diaryHeading = await page
			.getByRole("heading", { level: 1, name: "Diários", exact: true })
			.boundingBox();
		const diaryBook = await page
			.locator('[data-diary="astel"]')
			.boundingBox();
		expect(diaryHeading).not.toBeNull();
		expect(diaryBook).not.toBeNull();
		if (diaryHeading && diaryBook) {
			expect(Math.abs(diaryHeading.x - diaryKeyline.x)).toBeLessThanOrEqual(2);
			expect(Math.abs(diaryBook.x - diaryKeyline.x)).toBeLessThanOrEqual(2);
			expect(diaryBook.width).toBeGreaterThanOrEqual(1500);
			expect(diaryBook.width).toBeLessThanOrEqual(1542);
		}
	}
});

test("Lore archive keeps visible focus and disables artwork motion when requested", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1366, height: 768 });
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto("/lore");

	const firstLore = page
		.locator('section[aria-label="Lores publicadas"] article a')
		.first();
	const firstLoreHref = await firstLore.getAttribute("href");
	for (let index = 0; index < 8; index += 1) {
		await page.keyboard.press("Tab");
		if (
			(await page.evaluate(() => document.activeElement?.getAttribute("href"))) ===
			firstLoreHref
		) {
			break;
		}
	}
	await expect(firstLore).toBeFocused();
	const focusOutline = await firstLore.evaluate((element) => {
		const styles = getComputedStyle(element);
		return {
			style: styles.outlineStyle,
			width: Number.parseFloat(styles.outlineWidth),
		};
	});
	expect(focusOutline.style).not.toBe("none");
	expect(focusOutline.width).toBeGreaterThanOrEqual(2);

	const artworkTransition = await page
		.locator('section[aria-label="Lores publicadas"] article img')
		.first()
		.evaluate((element) => getComputedStyle(element).transitionDuration);
	expect(artworkTransition).toBe("0s");
});

test("Pipipi cinematic hero uses the reclaimed viewport in the shell gate", async ({
	page,
}) => {
	for (const viewport of [
		{ width: 390, height: 844 },
		{ width: 1366, height: 768 },
	]) {
		await page.setViewportSize(viewport);
		await page.goto("/lore/pipipi");
		const hero = page.locator("#topo");
		await expect(hero).toBeVisible();
		const box = await hero.boundingBox();
		expect(box).not.toBeNull();
		if (!box) continue;
		expect(box.y).toBeLessThanOrEqual(1);
		expect(box.height).toBeGreaterThanOrEqual(viewport.height * 0.8);
	}
});

test("Pipipi sticky chapter navigation clears the global chrome on mobile", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/lore/pipipi");

	const nav = page.getByRole("navigation", { name: "Capítulos da história" });
	await expect(nav).toBeVisible();
	await nav.evaluate((element) => element.scrollIntoView({ block: "start" }));
	await page.evaluate(() => window.scrollBy(0, 160));
	await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);

	const [navBox, brandBox, triggerBox] = await Promise.all([
		nav.boundingBox(),
		page.locator(".brand").boundingBox(),
		page.locator(".account-menu-trigger").boundingBox(),
	]);
	expect(navBox).not.toBeNull();
	expect(brandBox).not.toBeNull();
	expect(triggerBox).not.toBeNull();
	if (!navBox || !brandBox || !triggerBox) return;

	const chromeBottom = Math.max(
		brandBox.y + brandBox.height,
		triggerBox.y + triggerBox.height,
	);
	expect(navBox.y).toBeGreaterThanOrEqual(chromeBottom + 4);
	expect(navBox.x).toBeGreaterThanOrEqual(-1);
	expect(navBox.x + navBox.width).toBeLessThanOrEqual(391);
});
