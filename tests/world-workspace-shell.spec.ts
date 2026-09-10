import { expect, test } from "@playwright/test";

test("World Workspace hides the public chrome and gives closed navigation zero canvas width", async ({
	page,
}, testInfo) => {
	test.skip(testInfo.project.name === "mobile", "Desktop width contract is covered separately from the mobile overlay.");

	await page.goto("/mundo");
	await expect(page.getByTestId("world-workspace")).toHaveAttribute(
		"data-world-navigation",
		"open",
	);
	await expect(page.locator(".site-header")).toBeHidden();
	await expect(page.locator("body > footer")).toBeHidden();

	const stage = page.getByTestId("world-workspace-stage");
	const navigation = page.getByTestId("world-workspace-navigation");
	await expect.poll(async () => (await navigation.boundingBox())?.width ?? 0).toBeGreaterThan(200);
	const openStage = await stage.boundingBox();

	expect(openStage).not.toBeNull();
	const openWidth = openStage?.width ?? 0;

	await page.getByRole("button", { name: "Recolher navegação do mundo" }).first().click();
	await expect(page.getByTestId("world-workspace")).toHaveAttribute(
		"data-world-navigation",
		"closed",
	);
	await expect(navigation).toBeHidden();
	await expect
		.poll(async () => (await stage.boundingBox())?.width ?? 0)
		.toBeGreaterThan(openWidth + 180);

	await page.getByRole("button", { name: "Explorar universo" }).click();
	await expect(page.getByTestId("world-workspace")).toHaveAttribute(
		"data-world-navigation",
		"open",
	);
});

test("World Workspace returns collapsed inspector width to the canvas", async ({ page }, testInfo) => {
	test.skip(testInfo.project.name === "mobile", "Desktop inspector width contract.");

	await page.goto("/mundo");
	await expect(page.getByTestId("world-workspace")).toHaveAttribute(
		"data-world-navigation",
		"open",
	);
	const canvas = page.getByTestId("world-canvas");
	const inspector = page.locator('aside[aria-live="polite"]');
	const before = await canvas.boundingBox();

	expect(before).not.toBeNull();
	await page.getByRole("button", { name: "Recolher painel de detalhes" }).click();
	await expect(page.getByRole("button", { name: "Abrir painel de detalhes" })).toBeVisible();
	await expect
		.poll(async () => (await inspector.boundingBox())?.width ?? -1)
		.toBeLessThan(2);
	await expect
		.poll(async () => (await canvas.boundingBox())?.width ?? 0)
		.toBeGreaterThan((before?.width ?? 0) + 40);
});

test("World Workspace navigation becomes a non-reserving overlay on mobile", async ({
	page,
}, testInfo) => {
	test.skip(testInfo.project.name !== "mobile", "Mobile overlay contract.");

	await page.goto("/mundo");
	await expect(page.getByTestId("world-workspace")).toHaveAttribute(
		"data-world-navigation",
		"closed",
	);
	const stage = page.getByTestId("world-workspace-stage");
	const before = await stage.boundingBox();

	await page.getByRole("button", { name: "Explorar universo" }).click();
	await expect(page.getByTestId("world-workspace")).toHaveAttribute(
		"data-world-navigation",
		"open",
	);
	await expect(page.getByTestId("world-workspace-navigation")).toBeVisible();
	const open = await stage.boundingBox();

	expect(before).not.toBeNull();
	expect(open).not.toBeNull();
	expect(Math.abs((open?.width ?? 0) - (before?.width ?? 0))).toBeLessThan(2);

	await page.getByRole("button", { name: "Recolher navegação do mundo" }).first().click();
	await expect(page.getByTestId("world-workspace")).toHaveAttribute(
		"data-world-navigation",
		"closed",
	);
	await expect(page.getByRole("button", { name: "Explorar universo" })).toBeVisible();
});

test("collapsed mobile inspector leaves document flow and keeps only its reopen control", async ({
	page,
}, testInfo) => {
	test.skip(testInfo.project.name !== "mobile", "Mobile inspector flow contract.");

	await page.goto("/mundo");
	const inspector = page.locator('aside[aria-live="polite"]');
	const collapse = page.getByRole("button", { name: "Recolher painel de detalhes" });

	await expect(inspector).toBeVisible();
	await expect(collapse).toBeVisible();
	await collapse.click();

	const reopen = page.getByRole("button", { name: "Abrir painel de detalhes" });
	await expect(reopen).toBeVisible();
	await expect
		.poll(async () => inspector.evaluate((element) => getComputedStyle(element).position))
		.toBe("fixed");
	await expect
		.poll(async () => (await inspector.boundingBox())?.height ?? 0)
		.toBeLessThanOrEqual(68);
	await reopen.click();
	await expect(page.getByRole("button", { name: "Recolher painel de detalhes" })).toBeVisible();
});
