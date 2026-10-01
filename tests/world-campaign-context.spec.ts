import { expect, test } from "@playwright/test";

const CAMPAIGN_A_PATH = "/campanhas/cronicas-da-mesa/mundo";
const CAMPAIGN_B_PATH = "/campanhas/antes-que-seja-tarde/mundo";

test("World campaign switch preserves explicit context across back, forward and reload", async ({
	page,
}) => {
	await page.goto(CAMPAIGN_A_PATH);
	await expect(page.locator('[data-world-campaign="yuhara-main"]')).toBeVisible();
	await expect(page.locator('[data-world-node="dandelion"]')).toBeVisible();

	await page.getByText("Trocar", { exact: true }).click();
	const campaignB = page.getByRole("link", {
		name: "Antes que seja tarde",
		exact: true,
	});
	await expect(campaignB).toHaveAttribute("href", CAMPAIGN_B_PATH);
	await campaignB.click();

	await expect(page).toHaveURL(new RegExp(`${CAMPAIGN_B_PATH.replaceAll("/", "\\/")}$`));
	await expect(page.locator('[data-world-empty="true"]')).toBeVisible();
	await expect(page.locator('[data-world-node="dandelion"]')).toHaveCount(0);

	await page.goBack();
	await expect(page).toHaveURL(new RegExp(`${CAMPAIGN_A_PATH.replaceAll("/", "\\/")}$`));
	await expect(page.locator('[data-world-campaign="yuhara-main"]')).toBeVisible();
	await expect(page.locator('[data-world-node="dandelion"]')).toBeVisible();

	await page.goForward();
	await expect(page).toHaveURL(new RegExp(`${CAMPAIGN_B_PATH.replaceAll("/", "\\/")}$`));
	await expect(page.locator('[data-world-empty="true"]')).toBeVisible();
	await expect(page.locator('[data-world-node="dandelion"]')).toHaveCount(0);

	await page.reload();
	await expect(page).toHaveURL(new RegExp(`${CAMPAIGN_B_PATH.replaceAll("/", "\\/")}$`));
	await expect(page.locator('[data-world-empty="true"]')).toBeVisible();
	await expect(page.locator('[data-world-node="dandelion"]')).toHaveCount(0);
});
