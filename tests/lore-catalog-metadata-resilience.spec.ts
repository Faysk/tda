import { expect, test, type Page } from "@playwright/test";

const LONG_CAMPAIGN_NAME =
	"Antes que seja tarde — As histórias que ainda cabem numa noite muito longa";

async function expectNoHorizontalOverflow(page: Page) {
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth + 1,
		),
	).toBe(true);
}

test("lore campaign metadata and artwork survive desktop, mobile and 200% zoom geometry", async ({
	page,
}) => {
	for (const viewport of [
		{ name: "desktop", width: 1920, height: 1080 },
		{ name: "mobile", width: 390, height: 844 },
		{ name: "zoom-200", width: 683, height: 384 },
	] as const) {
		await page.setViewportSize({ width: viewport.width, height: viewport.height });
		await page.goto("/lore");

		const card = page.locator('article[data-lore="seika"]');
		await card.scrollIntoViewIfNeeded();
		await expect(card).toBeVisible();

		const image = card.locator("img").first();
		await expect(image).toBeAttached();
		await expect
			.poll(() =>
				image.evaluate((node) => {
					const img = node as HTMLImageElement;
					return img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;
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
			LONG_CAMPAIGN_NAME,
		);

		await expect(metadata).toContainText(LONG_CAMPAIGN_NAME);
		await expect(card).toHaveAttribute(
			"data-lore-campaign",
			"antes-que-seja-tarde",
		);
		await expectNoHorizontalOverflow(page);

		const [cardBox, metadataBox] = await Promise.all([
			card.boundingBox(),
			metadata.boundingBox(),
		]);
		expect(cardBox, `${viewport.name} card geometry`).not.toBeNull();
		expect(metadataBox, `${viewport.name} metadata geometry`).not.toBeNull();
		if (cardBox && metadataBox) {
			expect(metadataBox.x).toBeGreaterThanOrEqual(cardBox.x - 1);
			expect(metadataBox.x + metadataBox.width).toBeLessThanOrEqual(
				cardBox.x + cardBox.width + 1,
			);
		}
	}
});
