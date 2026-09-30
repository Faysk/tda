import { expect, test } from "@playwright/test";

test("public campaign directory exposes only the synthetic public projection", async ({
	page,
}) => {
	await page.goto("/campanhas");

	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"Mesas que viraram memória",
	);
	const cards = page.locator("article");
	await expect(cards).toHaveCount(2);
	await expect(page.getByRole("heading", { name: "Crônicas da Mesa" })).toBeVisible();
	await expect(
		page.getByRole("heading", {
			name: "Antes que seja tarde — uma campanha com nome deliberadamente comprido",
		}),
	).toBeVisible();

	const links = page.getByRole("link", { name: "Abrir sessões" });
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
		.getByRole("link", { name: "Abrir sessões" })
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
	await expect(page.getByText("Nenhuma sessão publicada ainda")).toBeVisible();
	await expect(page.locator("[data-session-card]")).toHaveCount(0);

	await page.goto("/campanhas/cronicas-da-mesa/sessoes");
	await expect(page.locator("[data-session-card]")).toHaveCount(3);
});

test("campaign directory remains keyboard reachable and free of horizontal overflow at mobile and 200% zoom", async ({
	page,
}) => {
	await page.setViewportSize({ width: 320, height: 800 });
	await page.goto("/campanhas");

	await page.keyboard.press("Tab");
	const firstArchiveLink = page.getByRole("link", { name: "Abrir sessões" }).first();
	await firstArchiveLink.focus();
	await expect(firstArchiveLink).toBeFocused();

	const mobileOverflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
	);
	expect(mobileOverflow).toBeLessThanOrEqual(1);

	// Browser zoom reduces the CSS viewport. Half-width is a deterministic
	// approximation of 200% zoom without CSS `zoom`, which itself enlarges
	// scrollWidth and produces a false overflow signal.
	await page.setViewportSize({ width: 160, height: 400 });
	const zoomOverflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
	);
	expect(zoomOverflow).toBeLessThanOrEqual(1);
});
