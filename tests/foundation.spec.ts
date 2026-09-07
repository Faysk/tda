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

test("public shell stays usable at 320px", async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 800 });
	await page.goto("/");

	await expect(page.getByRole("navigation", { name: "Navegação principal" })).toBeVisible();
	await expect(
		page.getByRole("link", { name: "Sessões", exact: true }),
	).toBeVisible();
	await expect(page.getByRole("button", { name: /Tema/ })).toBeVisible();
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= innerWidth,
		),
	).toBeTruthy();

	await page.keyboard.press("Tab");
	await expect(page.getByRole("link", { name: "Pular para o conteúdo" })).toBeFocused();

	await page.goto("/sessoes");
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

test("official design tokens and brand variant follow the resolved theme", async ({
	page,
}) => {
	await page.emulateMedia({ colorScheme: "dark" });
	await page.goto("/");

	expect(
		await page.evaluate(() =>
			getComputedStyle(document.documentElement)
				.getPropertyValue("--ds-canvas")
				.trim(),
		),
	).toBe("#0a0c0f");
	expect(
		await page.locator(".brand-symbol-image--dark").evaluate((element) =>
			getComputedStyle(element).display,
		),
	).not.toBe("none");
	expect(
		await page.locator(".brand-symbol-image--light").evaluate((element) =>
			getComputedStyle(element).display,
		),
	).toBe("none");

	await page
		.getByRole("button", { name: /Tema do sistema \(escuro\)/ })
		.click();
	expect(
		await page.evaluate(() =>
			getComputedStyle(document.documentElement)
				.getPropertyValue("--ds-canvas")
				.trim(),
		),
	).toBe("#f3efe7");
	expect(
		await page.locator(".brand-symbol-image--dark").evaluate((element) =>
			getComputedStyle(element).display,
		),
	).toBe("none");
	expect(
		await page.locator(".brand-symbol-image--light").evaluate((element) =>
			getComputedStyle(element).display,
		),
	).not.toBe("none");
});

test("reduced motion removes decorative transitions", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto("/");
	const action = page.getByRole("link", { name: "Explorar as sessões" });
	await expect(action).toBeVisible();
	expect(
		await action.evaluate((element) => getComputedStyle(element).transitionDuration),
	).toBe("0s");
});

test("legacy session hashes map to reboot paths", async ({ page }) => {
	await page.goto("/#/sessao/nonexistent/resumo");
	await expect(page).toHaveURL(/\/sessoes\/nonexistent$/);
});

test("not-found state uses the public navigation contract", async ({ page }) => {
	const response = await page.goto("/sessoes/nonexistent");
	expect(response?.status()).toBe(404);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"Esta história não foi encontrada.",
	);
	await expect(page.getByRole("link", { name: "Voltar às sessões" })).toBeVisible();
});

test("unknown and private routes are not exposed", async ({ request }) => {
	expect((await request.get("/api/transcripts")).status()).toBe(404);
	expect((await request.get("/sessoes/nonexistent")).status()).toBe(404);
});
