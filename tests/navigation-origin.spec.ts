import { expect, test } from "@playwright/test";

test("public navigation preserves the current origin", async ({ page }) => {
	await page.goto("/");
	const origin = new URL(page.url()).origin;
	const archiveLink = page
		.getByRole("navigation", { name: "Navegação principal" })
		.getByRole("link", { name: "Sessões", exact: true });

	await expect(archiveLink).toHaveAttribute("href", "/sessoes");
	await archiveLink.click();

	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"As histórias até aqui",
	);
	expect(new URL(page.url()).origin).toBe(origin);
	expect(new URL(page.url()).pathname).toBe("/sessoes");
});
