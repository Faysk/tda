import { expect, test } from "@playwright/test";

test("mobile navigation is modal, touch-safe and restores focus when closed by its control", async ({
	page,
}, testInfo) => {
	test.skip(testInfo.project.name !== "mobile", "Mobile modal semantics contract.");

	await page.goto("/mundo");
	const trigger = page.getByRole("button", { name: "Explorar universo" });
	const stage = page.getByTestId("world-workspace-stage");

	await trigger.click();

	const navigation = page.getByRole("dialog", { name: "Navegação do mundo" });
	const close = page.getByRole("button", { name: "Recolher navegação do mundo" });
	await expect(navigation).toBeVisible();
	await expect(navigation).toHaveAttribute("aria-modal", "true");
	await expect(stage).toHaveAttribute("aria-hidden", "true");
	await expect(stage).toHaveAttribute("inert", "");

	const closeBox = await close.boundingBox();
	expect(closeBox).not.toBeNull();
	expect(closeBox?.width).toBeGreaterThanOrEqual(44);
	expect(closeBox?.height).toBeGreaterThanOrEqual(44);

	await close.click();

	await expect(page.getByTestId("world-workspace-navigation")).not.toHaveAttribute("role", "dialog");
	await expect(stage).not.toHaveAttribute("aria-hidden", "true");
	await expect(stage).not.toHaveAttribute("inert", "");
	await expect(trigger).toBeVisible();
	await expect(trigger).toBeFocused();
});

test("desktop navigation remains non-modal", async ({ page }, testInfo) => {
	test.skip(testInfo.project.name === "mobile", "Desktop navigation semantics contract.");

	await page.goto("/mundo");
	const navigation = page.getByTestId("world-workspace-navigation");
	const stage = page.getByTestId("world-workspace-stage");

	await expect(navigation).toBeVisible();
	await expect(navigation).not.toHaveAttribute("role", "dialog");
	await expect(navigation).not.toHaveAttribute("aria-modal", "true");
	await expect(stage).not.toHaveAttribute("aria-hidden", "true");
	await expect(stage).not.toHaveAttribute("inert", "");
});
