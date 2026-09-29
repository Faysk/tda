import { writeFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";

const viewports = [
	{ width: 1366, height: 768, label: "1366x768" },
	{ width: 1920, height: 1080, label: "1920x1080" },
	{ width: 2560, height: 1440, label: "2560x1440" },
	{ width: 390, height: 844, label: "390x844" },
	{ width: 320, height: 800, label: "320x800" },
] as const;

type Box = Readonly<{ x: number; y: number; width: number; height: number }>;

async function box(locator: Locator): Promise<Box> {
	await expect(locator).toBeVisible();
	const value = await locator.boundingBox();
	expect(value).not.toBeNull();
	if (!value) throw new Error("Expected visible geometry");
	return value;
}

async function installMarks(
	page: Page,
	marks: readonly Readonly<{ label: string; box: Box }>[],
	titleX: number,
) {
	await page.evaluate(
		({ marks, titleX }) => {
			document.querySelectorAll("[data-tda-geometry-mark]").forEach((node) => node.remove());
			for (const mark of marks) {
				const overlay = document.createElement("div");
				overlay.dataset.tdaGeometryMark = "true";
				Object.assign(overlay.style, {
					position: "fixed",
					left: `${mark.box.x}px`,
					top: `${mark.box.y}px`,
					width: `${mark.box.width}px`,
					height: `${mark.box.height}px`,
					border: "2px dashed #ff4d8d",
					boxSizing: "border-box",
					pointerEvents: "none",
					zIndex: "2147483646",
				});
				const label = document.createElement("span");
				label.textContent = mark.label;
				Object.assign(label.style, {
					position: "absolute",
					left: "0",
					top: "0",
					padding: "2px 5px",
					background: "#ff4d8d",
					color: "#08090b",
					font: "600 11px/1.2 monospace",
					whiteSpace: "nowrap",
				});
				overlay.append(label);
				document.body.append(overlay);
			}
			const keyline = document.createElement("div");
			keyline.dataset.tdaGeometryMark = "true";
			Object.assign(keyline.style, {
				position: "fixed",
				left: `${titleX}px`,
				top: "0",
				bottom: "0",
				width: "1px",
				background: "#5eead4",
				boxShadow: "0 0 0 1px rgba(0,0,0,.35)",
				pointerEvents: "none",
				zIndex: "2147483647",
			});
			document.body.append(keyline);
		},
		{ marks, titleX },
	);
}

async function clearMarks(page: Page) {
	await page.evaluate(() => {
		document.querySelectorAll("[data-tda-geometry-mark]").forEach((node) => node.remove());
	});
}

test("capture current public Sessions geometry before #1086 product patch", async ({ page }, testInfo) => {
	for (const viewport of viewports) {
		await page.setViewportSize({ width: viewport.width, height: viewport.height });
		await page.goto("/sessoes", { waitUntil: "networkidle" });

		const title = page.getByRole("heading", { level: 1, name: "As histórias até aqui" });
		const hero = page.locator('section[aria-labelledby="archive-title"]');
		const stats = page.locator('dl[aria-label="Resumo público do arquivo"]');
		const archive = page.locator('section[aria-label="Sessões publicadas"]');
		const firstCard = archive.locator("article").first();
		const firstSessionLink = firstCard.locator('a[href^="/sessoes/"]').first();

		const [titleBox, heroBox, statsBox, archiveBox, firstCardBox] = await Promise.all([
			box(title),
			box(hero),
			box(stats),
			box(archive),
			box(firstCard),
		]);
		const href = await firstSessionLink.getAttribute("href");
		expect(href).toMatch(/^\/sessoes\//u);

		const archiveMetrics = {
			viewport,
			title: titleBox,
			hero: heroBox,
			stats: statsBox,
			archive: archiveBox,
			firstCard: firstCardBox,
			titleStartX: titleBox.x,
			archiveStartY: archiveBox.y,
			heroEndY: heroBox.y + heroBox.height,
			firstCardStartY: firstCardBox.y,
		};
		await writeFile(
			testInfo.outputPath(`session-baseline-archive-${viewport.label}.json`),
			JSON.stringify(archiveMetrics, null, 2),
			"utf8",
		);
		await installMarks(
			page,
			[
				{ label: "hero", box: heroBox },
				{ label: "title", box: titleBox },
				{ label: "stats", box: statsBox },
				{ label: "archive", box: archiveBox },
				{ label: "first card", box: firstCardBox },
			],
			titleBox.x,
		);
		await page.screenshot({
			path: testInfo.outputPath(`session-baseline-archive-${viewport.label}.png`),
			fullPage: false,
		});
		await clearMarks(page);

		await page.goto(href ?? "/sessoes", { waitUntil: "networkidle" });
		const readerTitle = page.getByRole("heading", { level: 1 }).first();
		const article = page.locator("article").first();
		const readerHero = article.locator("header").first();
		const back = page.getByRole("link", { name: /Arquivo de sessões/u }).first();
		const story = page.locator(".story-content").first();
		const pagination = page.getByRole("navigation", { name: "Navegação entre sessões" });

		const [readerTitleBox, readerHeroBox, backBox, storyBox] = await Promise.all([
			box(readerTitle),
			box(readerHero),
			box(back),
			box(story),
		]);
		const paginationBox = (await pagination.count()) > 0 ? await box(pagination) : null;
		const readerMetrics = {
			viewport,
			title: readerTitleBox,
			hero: readerHeroBox,
			back: backBox,
			story: storyBox,
			pagination: paginationBox,
			titleStartX: readerTitleBox.x,
			readingWidth: storyBox.width,
			heroEndY: readerHeroBox.y + readerHeroBox.height,
		};
		await writeFile(
			testInfo.outputPath(`session-baseline-reader-${viewport.label}.json`),
			JSON.stringify(readerMetrics, null, 2),
			"utf8",
		);
		await installMarks(
			page,
			[
				{ label: "hero", box: readerHeroBox },
				{ label: "back", box: backBox },
				{ label: "title", box: readerTitleBox },
				{ label: "reading", box: storyBox },
				...(paginationBox ? [{ label: "prev / next", box: paginationBox }] : []),
			],
			readerTitleBox.x,
		);
		await page.screenshot({
			path: testInfo.outputPath(`session-baseline-reader-${viewport.label}.png`),
			fullPage: false,
		});
		await clearMarks(page);
	}
});
