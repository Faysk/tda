import { expect, test } from "@playwright/test";

test("World Inspector exposes only tabs backed by visible projection data", async ({ page }) => {
	await page.goto("/mundo");
	await page.locator('[data-world-node="dandelion"]').click();

	const overview = page.getByRole("tab", { name: "Visão geral" });
	const relations = page.getByRole("tab", { name: /Laços/ });
	const moments = page.getByRole("tab", { name: /Momentos/ });
	await expect(overview).toHaveAttribute("aria-selected", "true");
	await expect(relations).toBeVisible();
	await expect(moments).toBeVisible();
	await expect(page.locator('[data-inspector-tab="overview"]')).toBeVisible();

	await relations.click();
	await expect(relations).toHaveAttribute("aria-selected", "true");
	const relationPanel = page.locator('[data-inspector-tab="relations"]');
	await expect(relationPanel).toBeVisible();
	await expect(relationPanel.getByText("Astel", { exact: true })).toBeVisible();
	await expect(relationPanel.getByText("Screacky", { exact: true })).toBeVisible();

	await moments.click();
	const momentsPanel = page.locator('[data-inspector-tab="moments"]');
	await expect(momentsPanel).toBeVisible();
	await expect(momentsPanel.getByText("A Porta do Kenku", { exact: true })).toBeVisible();
	await expect(momentsPanel.getByText("Fantasminhos", { exact: true })).toBeVisible();
	await expect(momentsPanel.getByText("Astel", { exact: true })).toHaveCount(0);
});

test("World Inspector resets navigation and hides unsupported tabs when selection changes", async ({ page }) => {
	await page.goto("/mundo");
	await page.locator('[data-world-node="dandelion"]').click();
	await page.getByRole("tab", { name: /Momentos/ }).click();
	await expect(page.locator('[data-inspector-tab="moments"]')).toBeVisible();

	await page.locator('[data-world-node="astel"]').click();
	await expect(page.getByRole("heading", { name: "Astel" })).toBeVisible();
	await expect(page.getByRole("tab", { name: "Visão geral" })).toHaveAttribute("aria-selected", "true");
	await expect(page.getByRole("tab", { name: /Momentos/ })).toHaveCount(0);
	await expect(page.locator('[data-inspector-tab="overview"]')).toBeVisible();
});
