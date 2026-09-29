import { writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

type Box = NonNullable<Awaited<ReturnType<ReturnType<Page["locator"]>["boundingBox"]>>>;

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

test("public Sessions keeps archive value in the first viewport and reader measure healthy", async ({
	page,
}, testInfo) => {
	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		await page.goto("/sessoes");

		const archiveTitle = page.getByRole("heading", {
			level: 1,
			name: "As histórias até aqui",
		});
		const archiveHero = archiveTitle.locator("xpath=ancestor::section[1]");
		const stats = page.locator('dl[aria-label="Resumo público do arquivo"]');
		const firstCard = page.locator('[data-session-view="grid"] article').first();
		const brand = page.locator(".brand");
		const account = page.locator(".account-menu-trigger");

		await expect(firstCard).toBeVisible();
		const [titleBox, heroBox, statsBox, cardBox, brandBox, accountBox] =
			await Promise.all([
				requiredBox(archiveTitle),
				requiredBox(archiveHero),
				requiredBox(stats),
				requiredBox(firstCard),
				requiredBox(brand),
				requiredBox(account),
			]);

		expect(overlaps(titleBox, brandBox)).toBeFalsy();
		expect(overlaps(titleBox, accountBox)).toBeFalsy();
		expect(cardBox.y).toBeLessThan(viewport.height);
		expect(statsBox.height).toBeLessThan(heroBox.height / 2);
		if (viewport.width <= 390) {
			expect(heroBox.height).toBeLessThanOrEqual(540);
		}
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth + 1,
			),
		).toBeTruthy();

		const archiveMetrics = {
			surface: "archive",
			viewport,
			title: titleBox,
			hero: heroBox,
			stats: statsBox,
			firstCard: cardBox,
		};
		await writeFile(
			testInfo.outputPath(`session-layout-archive-${viewport.label}.json`),
			JSON.stringify(archiveMetrics, null, 2),
			"utf8",
		);
		await page.screenshot({
			path: testInfo.outputPath(`session-layout-archive-${viewport.label}.png`),
			fullPage: true,
		});

		await page.goto("/sessoes/layout-contract-synthetic");
		const readerTitle = page.getByRole("heading", {
			level: 1,
			name: "Sessão Sintética de Layout",
		});
		const readerHero = readerTitle.locator("xpath=ancestor::header[1]");
		const back = page.getByRole("link", { name: "Arquivo de sessões" });
		const story = page.locator(".story-content").first();
		const pagination = page.getByRole("navigation", {
			name: "Navegação entre sessões",
		});
		await expect(pagination).toBeVisible();

		const [readerTitleBox, readerHeroBox, backBox, storyBox, paginationBox] =
			await Promise.all([
				requiredBox(readerTitle),
				requiredBox(readerHero),
				requiredBox(back),
				requiredBox(story),
				requiredBox(pagination),
			]);

		expect(Math.abs(readerTitleBox.x - backBox.x)).toBeLessThanOrEqual(1);
		if (viewport.width >= 1366) {
			expect(storyBox.width).toBeGreaterThanOrEqual(760);
			expect(storyBox.width).toBeLessThanOrEqual(900);
			expect(paginationBox.height).toBeLessThanOrEqual(300);
		}
		expect(overlaps(readerTitleBox, brandBox)).toBeFalsy();
		expect(overlaps(readerTitleBox, accountBox)).toBeFalsy();
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth + 1,
			),
		).toBeTruthy();

		const readerMetrics = {
			surface: "reader",
			viewport,
			title: readerTitleBox,
			hero: readerHeroBox,
			back: backBox,
			story: storyBox,
			pagination: paginationBox,
		};
		await writeFile(
			testInfo.outputPath(`session-layout-reader-${viewport.label}.json`),
			JSON.stringify(readerMetrics, null, 2),
			"utf8",
		);
		await page.screenshot({
			path: testInfo.outputPath(`session-layout-reader-${viewport.label}.png`),
			fullPage: true,
		});
	}
});
