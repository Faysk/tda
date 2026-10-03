import { expect, test } from "@playwright/test";

test("account separates project-wide authority from explicit campaign access", async ({
	page,
}) => {
	await page.goto("/e2e-fixtures/account-overview?state=project");
	await expect(page.getByRole("heading", { level: 2, name: "Acesso efetivo" })).toBeVisible();
	await expect(page.getByRole("heading", { level: 3, name: "Autoridade do projeto" })).toBeVisible();
	await expect(page.getByText("Crônicas da Mesa", { exact: true })).toHaveCount(0);

	await page.goto("/e2e-fixtures/account-overview?state=multi");
	await expect(page.getByRole("heading", { level: 3, name: "Campanha A" })).toBeVisible();
	await expect(
		page.getByRole("heading", {
			level: 3,
			name: /Antes que seja tarde/u,
		}),
	).toBeVisible();
	await expect(page.getByText("campaign/campaign-a", { exact: true })).not.toBeVisible();

	const campaignA = page
		.locator("section")
		.filter({ has: page.getByRole("heading", { level: 3, name: "Campanha A" }) });
	const transcriptGroup = campaignA.getByText("Transcrições e processamento", {
		exact: true,
	});
	await transcriptGroup.click();
	await expect(campaignA.getByText("Ler transcrições", { exact: true })).toBeVisible();

	const technical = campaignA.getByText("Detalhes técnicos do acesso", {
		exact: true,
	});
	await technical.focus();
	await expect(technical).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(page.getByText("campaign/campaign-a", { exact: true })).toBeVisible();
});

test("account keeps discovery failure distinct from no permission", async ({ page }) => {
	await page.goto("/e2e-fixtures/account-overview?state=campaign-error");
	await expect(
		page.getByText(/não foi possível carregar o diretório autorizado de campanhas/iu),
	).toBeVisible();
	await expect(
		page.getByText("Nenhuma permissão efetiva disponível para esta conta.", {
			exact: true,
		}),
	).toHaveCount(0);
});

test("account campaign context reflows at 320px, 390px and zoom-equivalent desktop", async ({
	page,
}) => {
	for (const viewport of [
		{ width: 320, height: 800 },
		{ width: 390, height: 844 },
		{ width: 960, height: 540 },
	]) {
		await page.setViewportSize(viewport);
		await page.goto("/e2e-fixtures/account-overview?state=multi");
		await expect(
			page.getByRole("heading", {
				level: 3,
				name: /Antes que seja tarde/u,
			}),
		).toBeVisible();
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
		);
		expect(overflow).toBeLessThanOrEqual(1);
	}
});
