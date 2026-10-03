import { expect, test } from "@playwright/test";

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
	);
	expect(overflow).toBeLessThanOrEqual(1);
}

test("confirm mode stages selection, keeps management actions separate and announces navigation", async ({
	page,
}) => {
	await page.goto(
		"/e2e-fixtures/campaign-picker?mode=confirm&current=alpha",
	);

	const trigger = page.getByRole("button", { name: "Campanha de teste" });
	await trigger.focus();
	await expect(trigger).toBeFocused();
	await page.keyboard.press("Enter");

	const listbox = page.getByRole("listbox", { name: "Campanha de teste" });
	await expect(listbox).toBeVisible();
	await expect(listbox.getByRole("option")).toHaveCount(3);
	await expect(
		listbox.getByRole("option", { name: "Campanha histórica · Arquivada" }),
	).toBeDisabled();

	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("Enter");
	await expect(trigger).toBeFocused();
	await expect(page).toHaveURL(/current=alpha/u);
	await expect(
		page.getByText(/Seleção pronta: Antes que seja tarde.*continua em Crônicas da Mesa/u),
	).toBeVisible();

	await page.getByRole("button", { name: "Gerir campanhas" }).click();
	await expect(page.getByTestId("admin-action")).toHaveText("Ação gerir acionada.");
	await expect(page).toHaveURL(/current=alpha/u);

	await page.getByRole("button", { name: "Trocar campanha" }).click();
	await expect(page.getByRole("status")).toContainText("Abrindo Antes que seja tarde");
	await expect(trigger).toBeDisabled();
	await expect(page).toHaveURL(/current=beta/u);
	await expect(page.getByTestId("route-context")).toHaveText("Contexto da rota: beta");
});

test("immediate mode applies selection directly and Escape restores focus", async ({
	page,
}) => {
	await page.goto(
		"/e2e-fixtures/campaign-picker?mode=immediate&current=beta",
	);
	const trigger = page.getByRole("button", { name: "Campanha de teste" });

	await trigger.click();
	await expect(page.getByRole("listbox", { name: "Campanha de teste" })).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(trigger).toBeFocused();

	await trigger.click();
	await page.getByRole("option", { name: "Crônicas da Mesa" }).click();
	await expect(page.getByRole("status")).toContainText("Abrindo Crônicas da Mesa");
	await expect(page).toHaveURL(/current=alpha/u);
});

test("optional domains can keep Geral as null and duplicate human names stay distinct", async ({
	page,
}) => {
	await page.goto("/e2e-fixtures/campaign-picker?mode=confirm&current=alpha");
	const trigger = page.getByRole("button", { name: "Classificação da referência" });

	await expect(trigger).toContainText("Geral");
	await expect(page.getByTestId("classification-value")).toHaveText("null");

	await trigger.click();
	const options = page.getByRole("listbox", { name: "Classificação da referência" }).getByRole("option", {
		name: "Mesa",
	});
	await expect(options).toHaveCount(2);
	await options.nth(1).click();
	await expect(page.getByTestId("classification-value")).toHaveText(
		"22222222-2222-4222-8222-222222222222",
	);
});

test("picker reflows at 320, 390 and the governed 200% proxy with reduced motion", async ({
	page,
}) => {
	await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
	for (const viewport of [
		{ width: 320, height: 800 },
		{ width: 390, height: 844 },
		{ width: 683, height: 384 },
		{ width: 960, height: 540 },
	]) {
		await page.setViewportSize(viewport);
		await page.goto("/e2e-fixtures/campaign-picker?mode=confirm&current=alpha");
		await expect(page.getByRole("button", { name: "Campanha de teste" })).toBeVisible();
		await expectNoHorizontalOverflow(page);
	}
});
