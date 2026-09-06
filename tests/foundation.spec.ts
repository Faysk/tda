import { expect, test } from "@playwright/test";

test("home and archive work without cloud secrets", async ({ page }) => {
	await page.goto("/");
	await expect(page.getByRole("heading", { level: 1 })).toContainText(
		"Toda jornada",
	);
	await page.getByRole("link", { name: "Explorar as sessões" }).click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"As histórias até aqui",
	);
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= innerWidth,
		),
	).toBeTruthy();
});

test("theme preference cycles and persists", async ({ page }) => {
	await page.emulateMedia({ colorScheme: "dark" });
	await page.goto("/");
	const toggle = page.getByRole("button", { name: /Tema do sistema \(escuro\)/ });
	await expect(toggle).toBeVisible();

	await toggle.click();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
	expect(await page.evaluate(() => localStorage.getItem("tda-theme"))).toBe(
		"light",
	);

	await page.reload();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
	await page.getByRole("button", { name: /Tema claro/ }).click();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

	await page.getByRole("button", { name: /Tema escuro/ }).click();
	await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
	expect(await page.evaluate(() => localStorage.getItem("tda-theme"))).toBeNull();
});

test("legacy session hashes map to reboot paths", async ({ page }) => {
	await page.goto("/#/sessao/nonexistent/resumo");
	await expect(page).toHaveURL(/\/sessoes\/nonexistent$/);
});

test("unknown and private routes are not exposed", async ({ request }) => {
	expect((await request.get("/api/transcripts")).status()).toBe(404);
	expect((await request.get("/sessoes/nonexistent")).status()).toBe(404);
});
