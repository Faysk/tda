import { expect, test } from "@playwright/test";

test("World floating chrome owns the canvas controls without changing their contracts", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto("/mundo");

	const chrome = page.getByTestId("world-floating-chrome");
	await expect(chrome).toBeVisible();
	await expect(chrome.getByRole("searchbox", { name: "Buscar no mundo" })).toBeVisible();
	await expect(chrome.getByRole("button", { name: "Filtrar por relação" })).toBeVisible();
	await expect(chrome.getByRole("button", { name: "Reorganizar" })).toBeVisible();
	await expect(chrome.getByRole("button", { name: "Canvas" })).toHaveAttribute("aria-pressed", "true");
	await expect(chrome.getByRole("button", { name: "Lista" })).toHaveAttribute("aria-pressed", "false");

	const paint = await chrome.evaluate((element) => {
		const primary = element.firstElementChild as HTMLElement | null;
		if (!primary) throw new Error("Floating chrome primary surface not found");
		const style = getComputedStyle(primary);
		return {
			background: style.backgroundColor,
			borderWidth: style.borderTopWidth,
			borderRadius: style.borderTopLeftRadius,
			backdropFilter: style.backdropFilter,
		};
	});
	expect(paint.background).not.toBe("rgba(0, 0, 0, 0)");
	expect(paint.borderWidth).not.toBe("0px");
	expect(paint.borderRadius).not.toBe("0px");
	expect(paint.backdropFilter).not.toBe("none");

	await chrome.getByRole("button", { name: "Lista" }).click();
	await expect(page.getByTestId("world-canvas")).toHaveCount(0);
	await expect(page.getByRole("heading", { name: "Relações em lista" })).toBeVisible();

	await chrome.getByRole("button", { name: "Canvas" }).click();
	await expect(page.getByTestId("world-canvas")).toBeVisible();
});

test("World floating chrome remains touch-safe and contained on mobile", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/mundo");

	const chrome = page.getByTestId("world-floating-chrome");
	await expect(chrome).toBeVisible();

	for (const control of [
		chrome.getByRole("button", { name: "Filtrar por relação" }),
		chrome.getByRole("button", { name: "Canvas" }),
		chrome.getByRole("button", { name: "Lista" }),
		chrome.getByRole("button", { name: "Todos" }),
	]) {
		const box = await control.boundingBox();
		expect(box).not.toBeNull();
		expect(box?.height ?? 0).toBeGreaterThanOrEqual(40);
	}

	expect(
		await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
	).toBeTruthy();
});
