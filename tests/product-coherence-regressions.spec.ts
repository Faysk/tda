import { expect, test, type Locator } from "@playwright/test";

const LONG_CAMPAIGN = "Expedição pelos Confins do Reino das Estrelas Cadentes";

async function expectReadableControlText(locator: Locator, viewportWidth: number) {
	const metrics = await locator.evaluate((element) => {
		const target = element.querySelector("span") ?? element;
		const box = target.getBoundingClientRect();
		const style = getComputedStyle(target);
		return {
			left: box.left,
			right: box.right,
			scrollWidth: target.scrollWidth,
			clientWidth: target.clientWidth,
			scrollHeight: target.scrollHeight,
			clientHeight: target.clientHeight,
			whiteSpace: style.whiteSpace,
		};
	});
	expect(metrics.left, "campaign label starts inside the viewport").toBeGreaterThanOrEqual(-1);
	expect(metrics.right, "campaign label ends inside the viewport").toBeLessThanOrEqual(viewportWidth + 1);
	expect(metrics.scrollWidth, "campaign label is not horizontally clipped").toBeLessThanOrEqual(metrics.clientWidth + 1);
	expect(metrics.scrollHeight, "campaign label is not vertically clipped").toBeLessThanOrEqual(metrics.clientHeight + 1);
	return metrics;
}

test("[regression #1346] Lembra preserves long campaign identity across small and zoom-equivalent viewports", async ({
	page,
}, testInfo) => {
	for (const viewport of [
		{ width: 320, height: 760 },
		{ width: 390, height: 844 },
		{ width: 683, height: 384 },
		{ width: 1366, height: 768 },
	]) {
		await page.setViewportSize(viewport);
		await page.goto("/e2e-fixtures/lembra-campaigns");

		const campaignFilter = page.getByRole("button", { name: "Filtrar por campanha" });
		await campaignFilter.click();
		const longOption = page.getByRole("option", { name: LONG_CAMPAIGN, exact: true });
		await expect(longOption).toBeVisible();
		await expectReadableControlText(longOption, viewport.width);
		await longOption.click();

		await expect(campaignFilter).toContainText(LONG_CAMPAIGN);
		const active = await expectReadableControlText(campaignFilter, viewport.width);
		expect(active.whiteSpace, "selected campaign may wrap instead of being forced into one clipped line").not.toBe("nowrap");
		await expect(page.getByRole("button", { name: "Confins", exact: true })).toBeVisible();

		const sort = page.getByRole("button", { name: "Ordenar referências" });
		await sort.click();
		for (const label of ["Mais recentes", "Mais antigas", "Nome", "Autor"]) {
			const option = page.getByRole("option", { name: label, exact: true });
			await expect(option).toBeVisible();
			await expectReadableControlText(option, viewport.width);
		}
		await page.keyboard.press("Escape");
		await expect(sort).toBeFocused();
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
			"the Lembra filter/sort row must not introduce horizontal overflow",
		).toBe(true);

		if (viewport.width === 320 || viewport.width === 390 || viewport.width === 683) {
			await page.screenshot({
				path: testInfo.outputPath(`product-coherence-regression-lembra-${viewport.width}x${viewport.height}.png`),
				fullPage: false,
			});
		}
	}
});
