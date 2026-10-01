import { expect, test } from "@playwright/test";

const CAMPAIGN_A = {
	route: "cronicas-da-mesa",
	name: "Crônicas da Mesa",
	title: "A memória mais recente do arquivo sintético",
} as const;

const CAMPAIGN_B = {
	route: "antes-que-seja-tarde",
	name: "Antes que seja tarde — uma campanha com nome deliberadamente comprido",
	title: "A memória global mais recente vem da campanha B",
} as const;

const SHARED_SESSION = "shared-session";

test("Home selects the newest public memory globally and keeps its campaign-qualified link", async ({ page }) => {
	await page.goto("/");
	await expect(page.getByRole("heading", { level: 1, name: CAMPAIGN_B.title })).toBeVisible();
	await expect(page.getByText(CAMPAIGN_B.name, { exact: false }).first()).toBeVisible();
	await expect(page.getByRole("link", { name: CAMPAIGN_B.title })).toHaveAttribute(
		"href",
		`/campanhas/${CAMPAIGN_B.route}/sessoes/${SHARED_SESSION}`,
	);
});

test("colliding public session identities stay scoped and canonical", async ({ page }) => {
	for (const campaign of [CAMPAIGN_A, CAMPAIGN_B]) {
		await page.goto(`/campanhas/${campaign.route}/sessoes/${SHARED_SESSION}`);
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(campaign.title);
		await expect(page.getByText(campaign.name, { exact: false }).first()).toBeVisible();
		await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
			"href",
			new RegExp(`/campanhas/${campaign.route}/sessoes/${SHARED_SESSION}$`, "u"),
		);
	}

	await page.goto(`/campanhas/${CAMPAIGN_A.route}/sessoes/${SHARED_SESSION}`);
	await expect(page.getByText("Mesmo source ID, outra campanha.")).toHaveCount(0);

	await page.goto(`/campanhas/${CAMPAIGN_B.route}/sessoes/${SHARED_SESSION}`);
	await expect(page.getByText("Mesmo source ID, outra campanha.")).toBeVisible();
	await expect(
		page.getByText("Conteúdo sintético usado somente pelos testes E2E do layout público."),
	).toHaveCount(0);
});

test("legacy aggregate redirects, while ambiguous legacy detail fails closed", async ({ page }) => {
	await page.goto("/sessoes");
	await expect(page).toHaveURL(/\/campanhas\/sessoes$/u);

	const response = await page.goto(`/sessoes/${SHARED_SESSION}`);
	expect(response?.status()).toBe(404);
	await expect(page).toHaveURL(new RegExp(`/sessoes/${SHARED_SESSION}$`, "u"));
	await expect(page.getByText(CAMPAIGN_A.title)).toHaveCount(0);
	await expect(page.getByText(CAMPAIGN_B.title)).toHaveCount(0);
});

test("aggregate archive preserves colliding sessions and filters by campaign", async ({ page }) => {
	await page.goto("/campanhas/sessoes");
	await expect(page.locator("[data-session-card]")).toHaveCount(4);
	await expect(page.getByRole("heading", { name: CAMPAIGN_A.title })).toBeVisible();
	await expect(page.getByRole("heading", { name: CAMPAIGN_B.title })).toBeVisible();

	const campaignFilter = page.getByLabel("Filtrar por campanha");
	await expect(campaignFilter).toContainText(CAMPAIGN_A.name);
	await expect(campaignFilter).toContainText(CAMPAIGN_B.name);

	await campaignFilter.selectOption(CAMPAIGN_A.route);
	await expect(page.getByRole("heading", { name: CAMPAIGN_A.title })).toBeVisible();
	await expect(page.getByRole("heading", { name: CAMPAIGN_B.title })).toHaveCount(0);

	await campaignFilter.selectOption(CAMPAIGN_B.route);
	await expect(page.getByRole("heading", { name: CAMPAIGN_B.title })).toBeVisible();
	await expect(page.getByRole("heading", { name: CAMPAIGN_A.title })).toHaveCount(0);
});

test("forged query, cookie and localStorage campaign hints are never authority", async ({ page }) => {
	await page.goto("/");
	await page.evaluate(() => {
		localStorage.setItem("campaignSlug", "antes-que-seja-tarde");
		localStorage.setItem("campaignId", "forged-campaign-id");
		document.cookie = "campaignSlug=antes-que-seja-tarde; Path=/";
		document.cookie = "campaignId=forged-campaign-id; Path=/";
	});

	await page.goto(`/campanhas/${CAMPAIGN_A.route}/sessoes/${SHARED_SESSION}?campaignSlug=${CAMPAIGN_B.route}&campaignId=forged-campaign-id`);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(CAMPAIGN_A.title);
	await expect(page.getByText(CAMPAIGN_B.title)).toHaveCount(0);
});

test("long source identities fail closed without leaking a sibling", async ({ page }) => {
	const response = await page.goto(
		`/campanhas/${CAMPAIGN_A.route}/sessoes/${"x".repeat(221)}`,
	);
	expect(response?.status()).toBe(404);
	await expect(page.getByText(CAMPAIGN_A.title)).toHaveCount(0);
	await expect(page.getByText(CAMPAIGN_B.title)).toHaveCount(0);
});

test("campaign archive controls remain keyboard reachable and overflow-free across the gate matrix", async ({ page }) => {
	const viewports = [
		{ width: 320, height: 800, label: "320x800" },
		{ width: 390, height: 844, label: "390x844" },
		{ width: 960, height: 540, label: "200%-equivalent" },
		{ width: 1366, height: 768, label: "1366x768" },
		{ width: 1920, height: 1080, label: "1920x1080" },
		{ width: 2560, height: 1440, label: "2560x1440" },
	] as const;

	for (const viewport of viewports) {
		await page.setViewportSize({ width: viewport.width, height: viewport.height });
		await page.goto("/campanhas/sessoes");

		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
		);
		expect(overflow, viewport.label).toBeLessThanOrEqual(1);

		const campaignFilter = page.getByLabel("Filtrar por campanha");
		await campaignFilter.focus();
		await expect(campaignFilter, viewport.label).toBeFocused();
		await page.keyboard.press("Tab");
		await expect(page.getByLabel("Filtrar por arco"), viewport.label).toBeFocused();
	}
});
