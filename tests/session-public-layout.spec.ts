import { writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

type Box = { x: number; y: number; width: number; height: number };

const viewports = [
	{ width: 1366, height: 768, label: "1366x768" },
	{ width: 1920, height: 1080, label: "1920x1080" },
	{ width: 2560, height: 1440, label: "2560x1440" },
	{ width: 390, height: 844, label: "390x844" },
	{ width: 320, height: 800, label: "320x800" },
] as const;

async function requiredBox(locator: ReturnType<Page["locator"]>) {
	const value = await locator.boundingBox();
	expect(value).not.toBeNull();
	return value as Box;
}

function overlaps(a: Box, b: Box) {
	return (
		a.x < b.x + b.width &&
		a.x + a.width > b.x &&
		a.y < b.y + b.height &&
		a.y + a.height > b.y
	);
}

async function sharedKeyline(page: Page) {
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
			x: Math.max(0, (innerWidth - layoutWidth) / 2) + gutter,
			contentWidth: layoutWidth - gutter * 2,
		};
	});
}

async function expectNoHorizontalOverflow(page: Page) {
	const overflow = await page.evaluate(() => ({
		scrollWidth: document.documentElement.scrollWidth,
		clientWidth: document.documentElement.clientWidth,
	}));
	expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

test("public Sessions keeps archive value in the first viewport and reader measure healthy", async ({
	page,
}, testInfo) => {
	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		await page.goto("/sessoes");

		const keyline = await sharedKeyline(page);
		const archiveTitle = page.getByRole("heading", {
			level: 1,
			name: "As histórias até aqui",
		});
		const archiveHero = page.locator("[data-session-archive-hero]");
		const archiveRail = page.locator("[data-session-archive-rail]");
		const stats = page.locator('dl[aria-label="Resumo público do arquivo"]');
		const firstCard = page.locator('[data-session-view="grid"] article').first();
		const fallback = firstCard.getByText("TDA", { exact: true });
		const brand = page.locator(".brand");
		const account = page.locator(".account-menu-trigger");

		await expect(firstCard).toBeVisible();
		await expect(fallback).toBeVisible();
		const [
			titleBox,
			heroBox,
			railBox,
			statsBox,
			cardBox,
			brandBox,
			accountBox,
		] = await Promise.all([
			requiredBox(archiveTitle),
			requiredBox(archiveHero),
			requiredBox(archiveRail),
			requiredBox(stats),
			requiredBox(firstCard),
			requiredBox(brand),
			requiredBox(account),
		]);

		expect(Math.abs(titleBox.x - keyline.x)).toBeLessThanOrEqual(2);
		expect(Math.abs(railBox.x - keyline.x)).toBeLessThanOrEqual(2);
		expect(overlaps(titleBox, brandBox)).toBeFalsy();
		expect(overlaps(titleBox, accountBox)).toBeFalsy();
		expect(cardBox.y).toBeLessThan(viewport.height);
		expect(statsBox.height).toBeLessThan(heroBox.height * 0.4);
		expect(heroBox.height).toBeLessThanOrEqual(viewport.width <= 390 ? 540 : 560);
		if (viewport.width >= 1920) {
			expect(railBox.width).toBeGreaterThanOrEqual(1450);
			expect(railBox.width).toBeLessThanOrEqual(1602);
			expect(cardBox.width).toBeLessThanOrEqual(540);
		}
		await expectNoHorizontalOverflow(page);

		await writeFile(
			testInfo.outputPath("session-layout-archive-" + viewport.label + ".json"),
			JSON.stringify(
				{
					surface: "archive",
					viewport,
					title: titleBox,
					hero: heroBox,
					stats: statsBox,
					rail: railBox,
					firstCard: cardBox,
				},
				null,
				2,
			),
			"utf8",
		);
		await page.screenshot({
			path: testInfo.outputPath("session-layout-archive-" + viewport.label + ".png"),
			fullPage: true,
		});

		await page.goto("/sessoes/layout-contract-synthetic");
		const readerKeyline = await sharedKeyline(page);
		const readerTitle = page.getByRole("heading", {
			level: 1,
			name: /Sessão Sintética de Layout/u,
		});
		const readerHero = page.locator("[data-session-reader-hero]");
		const back = page.getByRole("link", { name: "Arquivo de sessões" });
		const story = page.locator(".story-content").first();
		const previousLink = page.getByRole("link", { name: /Sessão anterior/u });
		const nextLink = page.getByRole("link", { name: /Próxima sessão/u });
		const readerBrand = page.locator(".brand");
		const readerAccount = page.locator(".account-menu-trigger");

		const [
			readerTitleBox,
			readerHeroBox,
			backBox,
			storyBox,
			previousBox,
			nextBox,
			readerBrandBox,
			readerAccountBox,
		] = await Promise.all([
			requiredBox(readerTitle),
			requiredBox(readerHero),
			requiredBox(back),
			requiredBox(story),
			requiredBox(previousLink),
			requiredBox(nextLink),
			requiredBox(readerBrand),
			requiredBox(readerAccount),
		]);

		expect(Math.abs(readerTitleBox.x - readerKeyline.x)).toBeLessThanOrEqual(2);
		expect(Math.abs(readerTitleBox.x - backBox.x)).toBeLessThanOrEqual(2);
		expect(overlaps(readerTitleBox, readerBrandBox)).toBeFalsy();
		expect(overlaps(readerTitleBox, readerAccountBox)).toBeFalsy();
		if (viewport.width >= 1366) {
			expect(storyBox.width).toBeGreaterThanOrEqual(760);
			expect(storyBox.width).toBeLessThanOrEqual(900);
			expect(previousBox.height).toBeLessThanOrEqual(160);
			expect(nextBox.height).toBeLessThanOrEqual(160);
		} else {
			expect(storyBox.width).toBeLessThanOrEqual(viewport.width - 40 + 1);
			expect(previousBox.height).toBeLessThanOrEqual(130);
			expect(nextBox.height).toBeLessThanOrEqual(130);
		}
		await expectNoHorizontalOverflow(page);

		await writeFile(
			testInfo.outputPath("session-layout-reader-" + viewport.label + ".json"),
			JSON.stringify(
				{
					surface: "reader",
					viewport,
					title: readerTitleBox,
					hero: readerHeroBox,
					back: backBox,
					story: storyBox,
					previous: previousBox,
					next: nextBox,
				},
				null,
				2,
			),
			"utf8",
		);
		await page.screenshot({
			path: testInfo.outputPath("session-layout-reader-" + viewport.label + ".png"),
			fullPage: true,
		});
	}
});

test("Sessions public geometry survives light theme and reduced motion", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.addInitScript(() => localStorage.setItem("tda-theme", "light"));
	await page.emulateMedia({ reducedMotion: "reduce" });

	await page.goto("/sessoes");
	await expectNoHorizontalOverflow(page);
	const archiveCard = page.locator('[data-session-view="grid"] article').first();
	expect(
		await archiveCard.evaluate((element) => getComputedStyle(element).transitionDuration),
	).toBe("0s");

	await page.goto("/sessoes/layout-contract-synthetic");
	await expectNoHorizontalOverflow(page);
	const previousLink = page.getByRole("link", { name: /Sessão anterior/u });
	expect(
		await previousLink.evaluate((element) => getComputedStyle(element).transitionDuration),
	).toBe("0s");
});

test("unavailable session state respects the public structural keyline", async ({
	page,
}, testInfo) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/sessoes/layout-contract-unavailable");
	const keyline = await sharedKeyline(page);
	const heading = page.getByRole("heading", {
		level: 1,
		name: "Esta sessão está temporariamente indisponível.",
	});
	await expect(heading).toBeVisible();

	const [headingBox, brandBox, triggerBox] = await Promise.all([
		requiredBox(heading),
		requiredBox(page.locator(".brand")),
		requiredBox(page.locator(".account-menu-trigger")),
	]);
	expect(Math.abs(headingBox.x - keyline.x)).toBeLessThanOrEqual(2);
	expect(headingBox.y).toBeGreaterThan(brandBox.y + brandBox.height);
	expect(headingBox.y).toBeGreaterThan(triggerBox.y + triggerBox.height);
	await expectNoHorizontalOverflow(page);

	await page.screenshot({
		path: testInfo.outputPath("session-layout-unavailable-390x844.png"),
		fullPage: true,
	});
});
