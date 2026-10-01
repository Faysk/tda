import { expect, test } from "@playwright/test";

test("public campaign directory exposes only the synthetic public projection", async ({
	page,
}) => {
	await page.goto("/campanhas");

	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Campanhas");
	const cards = page.locator("article");
	await expect(cards).toHaveCount(2);
	await expect(cards.first()).toHaveAttribute(
		"data-campaign-route",
		"cronicas-da-mesa",
	);
	await expect(
		cards.first().locator("[data-campaign-artwork-source]"),
	).toHaveAttribute("data-campaign-artwork-source", "campaign-cover");
	await expect(
		cards.nth(1).locator("[data-campaign-artwork-source]"),
	).toHaveAttribute("data-campaign-artwork-source", "latest-session-hero");
	await expect(page.getByText("Fixture privada", { exact: true })).toHaveCount(0);
	await expect(page.getByText("Fixture arquivada", { exact: true })).toHaveCount(0);
	const firstCardBox = await cards.first().boundingBox();
	expect(firstCardBox).not.toBeNull();
	expect(firstCardBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(600);
	await expect(page.getByRole("heading", { name: "Crônicas da Mesa" })).toBeVisible();
	await expect(
		page.getByRole("heading", {
			name: "Antes que seja tarde — uma campanha com nome deliberadamente comprido",
		}),
	).toBeVisible();

	const links = page.getByRole("link", { name: /Abrir campanha/u });
	await expect(links).toHaveCount(2);
	await expect(links.nth(0)).toHaveAttribute(
		"href",
		"/campanhas/cronicas-da-mesa/sessoes",
	);
	await expect(links.nth(1)).toHaveAttribute(
		"href",
		"/campanhas/antes-que-seja-tarde/sessoes",
	);
});

test("campaign cards open a campaign-qualified archive without leaking sibling sessions", async ({
	page,
}) => {
	await page.goto("/campanhas");

	await page
		.getByRole("article")
		.filter({ hasText: "Antes que seja tarde" })
		.getByRole("link", { name: /Abrir campanha/u })
		.click();

	await expect(page).toHaveURL(
		/\/campanhas\/antes-que-seja-tarde\/sessoes$/u,
	);
	await expect(
		page.getByRole("heading", {
			level: 1,
			name: /Antes que seja tarde/u,
		}),
	).toBeVisible();
	await expect(page.locator("[data-session-card]")).toHaveCount(1);
	await expect(
		page.getByRole("heading", {
			name: "A memória global mais recente vem da campanha B",
		}),
	).toBeVisible();
	await expect(
		page.getByRole("heading", {
			name: "A memória mais recente do arquivo sintético",
		}),
	).toHaveCount(0);

	await page.goto("/campanhas/cronicas-da-mesa/sessoes");
	await expect(page.locator("[data-session-card]")).toHaveCount(3);
	await expect(
		page.getByRole("heading", {
			name: "A memória mais recente do arquivo sintético",
		}),
	).toBeVisible();
	await expect(
		page.getByRole("heading", {
			name: "A memória global mais recente vem da campanha B",
		}),
	).toHaveCount(0);
});

test("campaign directory remains keyboard reachable and free of horizontal overflow at mobile and 200% zoom", async ({
	page,
}) => {
	await page.setViewportSize({ width: 320, height: 800 });
	await page.goto("/campanhas");

	await page.keyboard.press("Tab");
	const firstArchiveLink = page.getByRole("link", { name: /Abrir campanha/u }).first();
	await firstArchiveLink.focus();
	await expect(firstArchiveLink).toBeFocused();

	const mobileOverflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
	);
	expect(mobileOverflow).toBeLessThanOrEqual(1);

	// Browser zoom reduces the CSS viewport. Model a 1920×1080 desktop at
	// 200% zoom as a 960×540 CSS viewport. Going below the product-wide
	// 320px minimum would test an unsupported viewport rather than zoom.
	await page.setViewportSize({ width: 960, height: 540 });
	const zoomOverflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
	);
	expect(zoomOverflow).toBeLessThanOrEqual(1);
});

const WORLD_A_PATH = "/campanhas/cronicas-da-mesa/mundo";
const WORLD_B_PATH = "/campanhas/antes-que-seja-tarde/mundo";

test("World campaign switch preserves explicit context across back, forward and reload", async ({
	page,
}) => {
	await page.goto(WORLD_A_PATH);
	await expect(
		page.locator('[data-world-edit-state][data-world-campaign="yuhara-main"]'),
	).toBeVisible();
	await expect(page.locator('[data-world-node="dandelion"]')).toBeVisible();

	const navigationClose = page.getByRole("button", {
		name: "Recolher navegação do mundo",
	});
	if (await navigationClose.isVisible().catch(() => false)) {
		await navigationClose.click();
	}
	const campaignSwitch = page.getByText("Trocar", { exact: true });
	await campaignSwitch.focus();
	await expect(campaignSwitch).toBeFocused();
	await page.keyboard.press("Enter");
	const campaignB = page.getByRole("link", {
		name: /^Antes que seja tarde/u,
	});
	await expect(campaignB).toHaveAttribute("href", WORLD_B_PATH);
	await campaignB.focus();
	await expect(campaignB).toBeFocused();
	await page.keyboard.press("Enter");

	await expect(page).toHaveURL(/\/campanhas\/antes-que-seja-tarde\/mundo$/u);
	await expect(page.locator('[data-world-empty="true"]')).toBeVisible();
	await expect(page.locator('[data-world-node="dandelion"]')).toHaveCount(0);

	await page.goBack();
	await expect(page).toHaveURL(/\/campanhas\/cronicas-da-mesa\/mundo$/u);
	await expect(
		page.locator('[data-world-edit-state][data-world-campaign="yuhara-main"]'),
	).toBeVisible();
	await expect(page.locator('[data-world-node="dandelion"]')).toBeVisible();

	await page.goForward();
	await expect(page).toHaveURL(/\/campanhas\/antes-que-seja-tarde\/mundo$/u);
	await expect(page.locator('[data-world-empty="true"]')).toBeVisible();
	await expect(page.locator('[data-world-node="dandelion"]')).toHaveCount(0);

	await page.reload();
	await expect(page).toHaveURL(/\/campanhas\/antes-que-seja-tarde\/mundo$/u);
	await expect(page.locator('[data-world-empty="true"]')).toBeVisible();
	await expect(page.locator('[data-world-node="dandelion"]')).toHaveCount(0);
});
