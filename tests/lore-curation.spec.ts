import { expect, test } from "@playwright/test";

test("curated lore catalogue discovers every listed experience exactly once", async ({
	page,
}) => {
	await page.goto("/lore");

	for (const slug of ["astel", "noah", "pipipi", "seika", "d", "yllith"] as const) {
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
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
		);
		expect(overflow).toBeLessThanOrEqual(1);
	}
});
