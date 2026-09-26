import { expect, test } from "@playwright/test";

test("review shows factual warning totals with bounded details and Unicode word count", async ({
	page,
}, testInfo) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/?review-contracts");
	await expect(
		page.getByRole("heading", { name: "whisper-detailed" }),
	).toBeVisible();
	await expect(
		page.getByText("Avisos", { exact: true }).locator("..").locator("strong"),
	).toHaveText("5000");
	await expect(
		page.getByText("Palavras", { exact: true }).locator("..").locator("strong"),
	).toHaveText("2");
	await page.locator("summary").click();
	await expect(page.locator("summary")).toHaveText(
		"5000 avisos do pipeline · mostrando 50 tipos dos primeiros 1000 avisos",
	);
	await expect(page.locator("details li")).toHaveCount(50);
	expect(
		await page.evaluate(
			() =>
				document.documentElement.scrollWidth <=
				document.documentElement.clientWidth,
		),
	).toBe(true);
	await page.screenshot({
		path: testInfo.outputPath("review-warnings.png"),
		fullPage: true,
	});
	expect(errors).toEqual([]);
});

test("historical review does not claim a verified total", async ({ page }) => {
	await page.goto("/?review-contracts&legacy");
	await expect(page.getByText("total histórico não verificado")).toBeVisible();
	await expect(page.locator("summary")).not.toContainText("primeiros");
});
