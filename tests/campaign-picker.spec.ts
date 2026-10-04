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

	for (const colorScheme of ["light", "dark"] as const) {
		test(`remains readable in ${colorScheme} theme`, async ({ page }) => {
			await page.setViewportSize({ width: 390, height: 844 });
			await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
			await page.goto("/e2e-fixtures/campaign-picker?scenario=many&mode=confirmed");
			await expect(page.getByRole("button", { name: "Campanha de teste" })).toBeVisible();
			await expect(page.getByRole("link", { name: /Gerenciar campanhas/ })).toBeVisible();
		});
	}

	test("owns popup palette and focus ring when app theme differs from the OS", async ({ page }, testInfo) => {
		await page.setViewportSize({ width: 390, height: 844 });

		for (const scenario of [
			{ theme: "dark" as const, os: "light" as const },
			{ theme: "light" as const, os: "dark" as const },
		]) {
			await page.emulateMedia({ colorScheme: scenario.os, reducedMotion: "reduce" });
			await page.goto("/");
			await page.evaluate((theme) => localStorage.setItem("tda-theme", theme), scenario.theme);
			await page.goto("/e2e-fixtures/campaign-picker?scenario=many&mode=confirmed");
			await expect(page.locator("html")).toHaveAttribute("data-theme", scenario.theme);

			const trigger = page.getByRole("button", { name: "Campanha de teste" });
			await trigger.focus();
			const focused = await trigger.evaluate((element) => {
				const style = getComputedStyle(element);
				return { boxShadow: style.boxShadow, outlineStyle: style.outlineStyle };
			});
			expect(focused.boxShadow).not.toBe("none");

			await trigger.click();
			const listbox = page.getByRole("listbox", { name: "Campanha de teste" });
			await expect(listbox).toBeVisible();
			const palette = await listbox.evaluate((element) => {
				const listStyle = getComputedStyle(element);
				const option = element.querySelector<HTMLElement>('[role="option"]');
				const optionStyle = option ? getComputedStyle(option) : null;
				return {
					background: listStyle.backgroundColor,
					optionColor: optionStyle?.color ?? "",
				};
			});
			expect(palette.background).not.toBe("rgba(0, 0, 0, 0)");
			expect(palette.optionColor).not.toBe("");

			const nativeContract = await page.evaluate(() => {
				const select = document.createElement("select");
				const option = document.createElement("option");
				option.textContent = "Contrato sintético";
				select.append(option);
				document.body.append(select);
				const selectStyle = getComputedStyle(select);
				const optionStyle = getComputedStyle(option);
				const result = {
					colorScheme: selectStyle.colorScheme,
					optionColor: optionStyle.color,
					optionBackground: optionStyle.backgroundColor,
				};
				select.remove();
				return result;
			});
			expect(nativeContract.colorScheme).toContain(scenario.theme);
			expect(nativeContract.optionColor).not.toBe(nativeContract.optionBackground);

			await page.screenshot({
				path: testInfo.outputPath(`campaign-picker-${scenario.theme}-on-${scenario.os}-os.png`),
				fullPage: false,
			});
			await listbox.press("Escape");
			await expect(trigger).toBeFocused();
		}
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
