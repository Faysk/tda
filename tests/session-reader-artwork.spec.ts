import { expect, test } from "@playwright/test";

test("session reader renders published cover artwork before hero artwork", async ({ page }) => {
	await page.goto("/campanhas/cronicas-da-mesa/sessoes/shared-session");

	const hero = page.locator("[data-session-reader-hero]");
	await expect(hero).toHaveAttribute("data-session-artwork-source", "cover");
	await expect(hero.locator("img")).toHaveCount(1);
	await expect(
		page.getByRole("heading", {
			level: 1,
			name: "A memória mais recente do arquivo sintético",
		}),
	).toBeVisible();
});

test("session reader falls back from cover to published hero without crossing campaigns", async ({
	page,
}) => {
	await page.goto("/campanhas/antes-que-seja-tarde/sessoes/shared-session");

	const hero = page.locator("[data-session-reader-hero]");
	await expect(hero).toHaveAttribute("data-session-artwork-source", "hero");
	await expect(hero.locator("img")).toHaveCount(1);
	await expect(
		page.getByRole("heading", {
			level: 1,
			name: "A memória global mais recente vem da campanha B",
		}),
	).toBeVisible();
	await expect(page.getByText("Crônicas da Mesa", { exact: true })).toHaveCount(0);
});

test("session reader keeps an intentional text hero when no artwork exists", async ({
	page,
}) => {
	await page.goto(
		"/campanhas/cronicas-da-mesa/sessoes/layout-contract-synthetic",
	);

	const hero = page.locator("[data-session-reader-hero]");
	await expect(hero).toHaveAttribute("data-session-artwork-source", "fallback");
	await expect(hero.locator("img")).toHaveCount(0);
	await expect(
		page.getByRole("heading", {
			level: 1,
			name: "Sessão Sintética de Layout com um título editorial mais longo",
		}),
	).toBeVisible();
});

test("reader artwork composition preserves mobile reflow", async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 800 });
	await page.goto("/campanhas/cronicas-da-mesa/sessoes/shared-session");

	await expect(page.locator("[data-session-reader-hero]")).toHaveAttribute(
		"data-session-artwork-source",
		"cover",
	);
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
	);
	expect(overflow).toBeLessThanOrEqual(1);
	await expect(page.getByRole("link", { name: /Arquivo de Crônicas da Mesa/u })).toBeVisible();
});
