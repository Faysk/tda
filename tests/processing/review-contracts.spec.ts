import { expect, test } from "@playwright/test";

test("base remains unsaved until an explicit editorial action", async ({ page }) => {
	await page.goto("/?review-contracts&ephemeral");
	await expect(page.getByText("Visualização da base. Nenhuma revisão foi salva.")).toBeVisible();
	await expect(page.getByRole("button", { name: "Salvar revisão" })).toBeDisabled();
	await page.getByLabel("Estado do draft").selectOption("approved_local");
	await page.getByRole("button", { name: "Salvar revisão" }).click();
	await expect(page.getByText("Draft salvo localmente.")).toBeVisible();
	await expect(page.getByText(/Run bruto imutável · draft r1/)).toBeVisible();
	await expect(page.getByRole("button", { name: "Salvar revisão" })).toBeDisabled();
});

test("older Agent remains readable and requires an update before editing", async ({ page }) => {
	await page.goto("/?review-contracts&old-agent");
	await expect(page.getByText(/Atualize o Companion para salvar/)).toBeVisible();
	await expect(page.getByRole("textbox", { name: "Texto", exact: true })).toBeDisabled();
	await expect(page.getByRole("button", { name: "Salvar revisão" })).toBeDisabled();
});

test("review shows factual warning totals with bounded details and Unicode word count", async ({
	page,
}, testInfo) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/?review-contracts");
	await expect(
		page.getByRole("heading", { name: "whisper-detailed" }),
	).toBeVisible();
	await expect(
		page.getByText("Avisos", { exact: true }).locator("..").locator("strong"),
	).toHaveText("5000");
	await expect(
		page.getByText("Palavras", { exact: true }).locator("..").locator("strong"),
	).toHaveText("2");
	await page.locator("summary").click();
	await expect(page.locator("summary")).toHaveText(
		"5000 avisos do pipeline · mostrando 50 tipos dos primeiros 1000 avisos",
	);
	await expect(page.locator("details li")).toHaveCount(50);
	expect(
		await page.evaluate(
			() =>
				document.documentElement.scrollWidth <=
				document.documentElement.clientWidth,
		),
	).toBe(true);
	await page.screenshot({
		path: testInfo.outputPath("review-warnings.png"),
		fullPage: true,
	});
	expect(errors).toEqual([]);
});

test("historical review does not claim a verified total", async ({ page }) => {
	await page.goto("/?review-contracts&legacy");
	await expect(page.getByText("total histórico não verificado")).toBeVisible();
	await expect(page.locator("summary")).not.toContainText("primeiros");
});
