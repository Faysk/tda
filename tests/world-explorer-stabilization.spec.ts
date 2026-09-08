import { expect, test } from "@playwright/test";

test("World Explorer keeps the mobile inspector recoverable with touch-sized controls", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto("/mundo");
	await page.locator('[data-world-node="astel"]').click();
	await expect(
		page.getByRole("heading", { level: 2, name: "Astel", exact: true }),
	).toBeVisible();

	const collapse = page.getByRole("button", {
		name: "Recolher painel de detalhes",
	});
	await expect(collapse).toBeVisible();
	await collapse.click();
	await expect(
		page.getByRole("heading", { level: 2, name: "Astel", exact: true }),
	).toHaveCount(0);

	await page.setViewportSize({ width: 390, height: 844 });
	const reopen = page.getByRole("button", {
		name: "Abrir painel de detalhes",
	});
	await expect(reopen).toBeVisible();

	const reopenTarget = await reopen.boundingBox();
	expect(reopenTarget).not.toBeNull();
	expect(reopenTarget?.width ?? 0).toBeGreaterThanOrEqual(44);
	expect(reopenTarget?.height ?? 0).toBeGreaterThanOrEqual(44);

	await reopen.click();
	await expect(
		page.getByRole("heading", { level: 2, name: "Astel", exact: true }),
	).toBeVisible();

	const overviewTab = page.getByRole("tab", { name: "Visão geral" });
	await expect(overviewTab).toBeVisible();
	const tabTarget = await overviewTab.boundingBox();
	expect(tabTarget).not.toBeNull();
	expect(tabTarget?.height ?? 0).toBeGreaterThanOrEqual(44);

	expect(
		await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
	).toBeTruthy();
});
