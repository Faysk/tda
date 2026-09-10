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
	const openStage = await stage.boundingBox();
	const openNavigation = await navigation.boundingBox();

	expect(openStage).not.toBeNull();
	expect(openNavigation).not.toBeNull();
	expect(openNavigation?.width ?? 0).toBeGreaterThan(200);

	await page.getByRole("button", { name: "Recolher navegação do mundo" }).first().click();
	await expect(page.getByTestId("world-workspace")).toHaveAttribute(
		"data-world-navigation",
		"closed",
	);
	await expect(navigation).toBeHidden();

	const closedStage = await stage.boundingBox();
	expect(closedStage).not.toBeNull();
	expect((closedStage?.width ?? 0) - (openStage?.width ?? 0)).toBeGreaterThan(180);

	await page.getByRole("button", { name: "Explorar universo" }).click();
	await expect(page.getByTestId("world-workspace")).toHaveAttribute(
		"data-world-navigation",
		"open",
	);
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
