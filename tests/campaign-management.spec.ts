import { expect, test } from "@playwright/test";

const FIXTURE = "/e2e-fixtures/campaign-manager";
const DESTINO_ID = "11111111-1111-4111-8111-111111111111";

test("campaign manager puts human campaigns and the primary action in the first viewport", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1366, height: 768 });
	await page.goto(FIXTURE);

	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Campanhas");
	await expect(page.getByText("Campaign Registry")).toHaveCount(0);
	await expect(page.getByText("Destino Sem Fim", { exact: true })).toBeVisible();
	await expect(page.getByText("Passos Retomados", { exact: true })).toBeVisible();

	const createSummary = page.locator("[data-campaign-create] > summary");
	await expect(createSummary).toContainText("Nova campanha");
	const createBox = await createSummary.boundingBox();
	expect(createBox).not.toBeNull();
	expect(createBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(260);

	const firstCampaign = page.locator("[data-campaign-management-item]").first();
	const firstBox = await firstCampaign.boundingBox();
	expect(firstBox).not.toBeNull();
	expect(firstBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(600);

	await expect(page.locator("[data-campaign-create]")).not.toHaveAttribute("open", "");
	await expect(
		firstCampaign.locator("[data-campaign-editor]"),
	).not.toHaveAttribute("open", "");
	await expect(firstCampaign.getByText("yuhara-main", { exact: true })).toBeHidden();
	await expect(firstCampaign.getByText(DESTINO_ID, { exact: true })).toBeHidden();
});

test("create and edit stay contextual and keyboard operable", async ({ page }) => {
	await page.goto(FIXTURE);

	const create = page.locator("[data-campaign-create]");
	const createSummary = create.locator(":scope > summary");
	await createSummary.focus();
	await expect(createSummary).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(create).toHaveJSProperty("open", true);
	await expect(create.getByRole("heading", { name: "Nova campanha" })).toBeVisible();

	const createAdvanced = create.locator("details").filter({
		has: page.getByText("Detalhes avançados", { exact: true }),
	});
	await expect(create.getByLabel("Chave técnica estável")).toBeHidden();
	await createAdvanced.locator(":scope > summary").click();
	await expect(create.getByLabel("Chave técnica estável")).toBeVisible();

	await createSummary.click();
	await expect(create).toHaveJSProperty("open", false);

	const items = page.locator("[data-campaign-management-item]");
	const first = items.nth(0);
	const second = items.nth(1);
	await first.locator("[data-campaign-editor] > summary").click();
	await expect(first.locator("[data-campaign-editor]")).toHaveJSProperty(
		"open",
		true,
	);
	await expect(second.locator("[data-campaign-editor]")).toHaveJSProperty(
		"open",
		false,
	);
	await expect(first.getByLabel("Nome")).toBeVisible();
	await expect(second.getByLabel("Nome")).toBeHidden();

	const advanced = first.locator("[data-campaign-advanced]");
	await expect(first.getByText("yuhara-main", { exact: true })).toBeHidden();
	await advanced.locator(":scope > summary").click();
	await expect(first.getByText("yuhara-main", { exact: true })).toBeVisible();
	await expect(first.getByText(DESTINO_ID, { exact: true })).toBeVisible();

	await expect(
		first.getByText(/Esta campanha está pública/u),
	).toBeVisible();

	const moreActions = first.locator("details").filter({
		has: page.getByText("Mais ações", { exact: true }),
	});
	await moreActions.locator(":scope > summary").click();
	const archiveConfirm = first.locator("[data-campaign-archive-confirm]");
	await expect(archiveConfirm.getByRole("button", { name: "Confirmar arquivamento" })).toBeHidden();
	const archiveSummary = archiveConfirm.locator(":scope > summary");
	await archiveSummary.focus();
	await expect(archiveSummary).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(
		archiveConfirm.getByRole("button", { name: "Confirmar arquivamento" }),
	).toBeVisible();
});

test("manager keeps feedback next to the operation that needs attention", async ({
	page,
}) => {
	await page.goto(
		`${FIXTURE}?erro=conflict&campanha=${encodeURIComponent(DESTINO_ID)}`,
	);

	const first = page.locator("[data-campaign-management-item]").first();
	const second = page.locator("[data-campaign-management-item]").nth(1);
	await expect(first.locator("[data-campaign-editor]")).toHaveJSProperty(
		"open",
		true,
	);
	await expect(first.getByRole("alert")).toContainText("Há um conflito");
	await expect(second.locator("[data-campaign-editor]")).toHaveJSProperty(
		"open",
		false,
	);

	await page.goto(`${FIXTURE}?erro=validation&campo=technicalSlug`);
	const create = page.locator("[data-campaign-create]");
	await expect(create).toHaveJSProperty("open", true);
	await expect(create.getByRole("alert")).toContainText("chave técnica");
	await expect(create.getByLabel("Chave técnica estável")).toBeVisible();

	await page.goto(`${FIXTURE}?status=criada`);
	await expect(page.getByRole("status").filter({ hasText: "Campanha criada" })).toBeVisible();
	await expect(page.locator("[data-campaign-create]")).toHaveJSProperty(
		"open",
		false,
	);
});

test("manager distinguishes zero, one and many campaigns with human status labels", async ({
	page,
}) => {
	await page.goto(`${FIXTURE}?state=zero`);
	await expect(page.locator("[data-campaign-management-item]")).toHaveCount(0);
	await expect(page.locator("[data-campaign-empty]")).toContainText(
		"Nenhuma campanha ainda",
	);

	await page.goto(`${FIXTURE}?state=one`);
	await expect(page.locator("[data-campaign-management-item]")).toHaveCount(1);
	await expect(page.getByText("Pública", { exact: true })).toBeVisible();
	await expect(page.getByText("Ativa", { exact: true })).toBeVisible();

	await page.goto(FIXTURE);
	const items = page.locator("[data-campaign-management-item]");
	await expect(items).toHaveCount(3);
	await expect(items.nth(0).getByText("Pública", { exact: true }).first()).toBeVisible();
	await expect(items.nth(1).getByText("Privada", { exact: true }).first()).toBeVisible();
	await expect(items.nth(2).getByText("Arquivada", { exact: true })).toBeVisible();
});

test("long names reflow without horizontal overflow on mobile and zoom-equivalent viewports", async ({
	page,
}) => {
	for (const viewport of [
		{ width: 320, height: 800 },
		{ width: 390, height: 844 },
		{ width: 960, height: 540 },
	]) {
		await page.setViewportSize(viewport);
		await page.goto(`${FIXTURE}?long=1`);
		await expect(
			page.getByRole("heading", {
				name: /Destino Sem Fim — campanha sintética/u,
			}),
		).toBeVisible();
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
		);
		expect(overflow).toBeLessThanOrEqual(1);
	}
});
