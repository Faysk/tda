import { expect, test } from "@playwright/test";

async function openPicker(page: import("@playwright/test").Page) {
	const trigger = page.getByRole("button", { name: "Campanha de teste" });
	await trigger.click();
	return page.getByRole("listbox", { name: "Campanha de teste" });
}

test.describe("shared campaign picker", () => {
	test("0 campaigns stays explicit and management remains a separate action", async ({ page }) => {
		await page.goto("/e2e-fixtures/campaign-picker?scenario=none&mode=confirmed");
		await expect(page.getByTestId("selected-context")).toHaveText("nenhuma");
		await expect(page.getByRole("button", { name: "Campanha de teste" })).toHaveText("Selecionar");
		await expect(page.getByRole("button", { name: "Abrir contexto" })).toBeDisabled();
		await expect(page.getByRole("link", { name: /Gerenciar campanhas/ })).toBeVisible();
	});

	test("one campaign changes immediately without inventing another context", async ({ page }) => {
		await page.goto("/e2e-fixtures/campaign-picker?scenario=one");
		const listbox = await openPicker(page);
		await listbox.getByRole("option", { name: "Campanha Alpha" }).click();
		await expect(page).toHaveURL(/selected=alpha/);
		await expect(page.getByTestId("selected-context")).toHaveText("alpha");
	});

	test("N campaigns preserve duplicate labels, long identity, archived state and confirmed semantics", async ({ page }) => {
		await page.goto("/e2e-fixtures/campaign-picker?scenario=many&mode=confirmed");
		const trigger = page.getByRole("button", { name: "Campanha de teste" });
		await trigger.focus();
		await page.keyboard.press("ArrowDown");
		const listbox = page.getByRole("listbox", { name: "Campanha de teste" });
		await expect(listbox.getByRole("option", { name: "Nome repetido" })).toHaveCount(2);
		await expect(listbox.getByRole("option", { name: "Memórias antigas (arquivada)" })).toBeDisabled();
		const longOption = listbox.getByRole("option", {
			name: "Os Arquivos Improváveis da Guilda do Pato que Continua Com Um Nome Editorial Deliberadamente Muito Longo",
		});
		await longOption.click();
		await expect(page).not.toHaveURL(/selected=long/);
		await expect(page.getByText("Seleção alterada. Confirme para abrir este contexto.")).toBeVisible();
		await page.getByRole("button", { name: "Abrir contexto" }).click();
		await expect(page).toHaveURL(/selected=long/);
	});

	for (const viewport of [
		{ width: 320, height: 760 },
		{ width: 390, height: 844 },
		{ width: 683, height: 384 },
	]) {
		test(`stays inside the viewport at ${viewport.width}px`, async ({ page }) => {
			await page.setViewportSize(viewport);
			await page.emulateMedia({ reducedMotion: "reduce" });
			await page.goto("/e2e-fixtures/campaign-picker?scenario=many&mode=confirmed");
			const overflow = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
			);
			expect(overflow).toBeLessThanOrEqual(1);
			await expect(page.getByRole("button", { name: "Campanha de teste" })).toBeVisible();
			await expect(page.getByRole("link", { name: /Gerenciar campanhas/ })).toBeVisible();
		});
	}
});
