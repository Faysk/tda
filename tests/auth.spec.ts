import { expect, test } from "@playwright/test";

test("provider fragment cancellation becomes a fixed safe message", async ({
	page,
}) => {
	await page.goto(
		"/entrar?erro=callback#error=access_denied&error_description=untrusted-provider-detail",
	);
	await expect(page).toHaveURL(/\/entrar\?erro=cancelado$/);
	await expect(page.locator("main").getByRole("alert")).toContainText(
		"Você cancelou",
	);
	await expect(page.locator("body")).not.toContainText(
		"untrusted-provider-detail",
	);
});

test("Discord entry is clear and has no alternate credentials", async ({
	page,
}) => {
	await page.goto("/entrar?erro=cancelado&next=//evil.test");
	await expect(
		page.getByRole("heading", { name: "Entre para continuar" }),
	).toBeVisible();
	await expect(page.locator("main").getByRole("alert")).toContainText(
		"Você cancelou",
	);
	await expect(
		page.getByRole("button", { name: "Entrar com Discord" }),
	).toBeDisabled();
	await expect(
		page.locator('input[type="password"], input[type="email"]'),
	).toHaveCount(0);
	await expect(page.locator('input[name="next"]')).toHaveValue("/conta");
	await expect(page.locator("body")).not.toContainText("Google");
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true);
});

test("administrative pages disclose no data when access resolution is unavailable", async ({
	page,
	request,
}) => {
	const result = await request.get("/api/auth/me");
	expect(result.status()).toBe(503);
	expect(await result.json()).toEqual({
		state: "unavailable",
		scope: { type: "campaign", id: "yuhara-main" },
		capabilities: [],
	});
	expect(result.headers()["cache-control"]).toContain("no-store");

	for (const path of [
		"/edit",
		"/edit/mundo",
		"/edit/processamento",
		"/edit/sessoes/private-fixture",
	]) {
		await page.goto(path);
		await expect(page).toHaveURL(/\/conta\?acesso=indisponivel$/);
		await expect(
			page.getByRole("heading", { name: "Acesso à campanha" }),
		).toBeVisible();
		await expect(page.locator("main").getByRole("alert")).toContainText(
			"não conseguiu verificar seu acesso",
		);
		await expect(page.locator("body")).not.toContainText("private-fixture");
	}

	expect((await request.get("/auth/logout")).status()).toBe(405);
	expect((await request.get("/auth/discord")).status()).toBe(405);
});
