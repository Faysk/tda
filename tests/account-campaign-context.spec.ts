import { expect, test } from "@playwright/test";

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
		),
	).toBe(true);
}

test("account names the single campaign and keeps technical identity secondary", async ({
	page,
}) => {
	await page.goto("/e2e-fixtures/account-overview");
	await expect(
		page.getByRole("heading", { name: "Acesso por campanha", exact: true }),
	).toBeVisible();
	await expect(
		page
			.locator('[data-account-campaign-summary="true"]')
			.getByText("Destino Sem Fim", { exact: true }),
	).toBeVisible();
	await expect(page.getByRole("button", { name: "Campanha consultada" })).toHaveCount(0);

	await page.getByText("Administração", { exact: true }).click();
	const administration = page.locator("details[open]").filter({ hasText: "Administração" });
	await expect(administration.getByRole("listitem").getByText("Gerenciar permissões", { exact: true })).toBeVisible();
	await expect(administration.getByText("Específica desta campanha", { exact: true })).toBeVisible();

	const technicalSlug = page.getByText("yuhara-main", { exact: true });
	await expect(technicalSlug).toBeHidden();
	await page.getByText("Detalhes técnicos do acesso", { exact: true }).click();
	await expect(technicalSlug).toBeVisible();
});

test("A+B requires an explicit choice and separates project authority from campaign access", async ({
	page,
}) => {
	await page.goto("/e2e-fixtures/account-overview?mode=multi");
	const selector = page.getByRole("button", { name: "Campanha consultada" });
	await expect(selector).toBeVisible();
	await expect(selector).toContainText("Escolha uma campanha");
	await selector.click();
	const campaignOptions = page.getByRole("listbox", { name: "Campanha consultada" });
	await expect(campaignOptions).toBeVisible();
	await expect(campaignOptions.getByRole("option")).toHaveCount(3);
	await expect(
		campaignOptions.getByRole("option", { name: "Destino Sem Fim", exact: true }),
	).toBeVisible();
	await expect(
		campaignOptions.getByRole("option", {
			name: "Passos Retomados — nome sintético deliberadamente comprido para reflow",
			exact: true,
		}),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(selector).toBeFocused();
	await expect(
		page.getByText("Escolha uma campanha para ver as permissões efetivas nesse contexto.", {
			exact: true,
		}),
	).toBeVisible();

	await page.goto(
		"/e2e-fixtures/account-overview?mode=multi&campanha=passos-retomados",
	);
	await expect(
		page
			.locator('[data-account-campaign-summary="true"]')
			.getByText(
				"Passos Retomados — nome sintético deliberadamente comprido para reflow",
				{ exact: true },
			),
	).toBeVisible();
	await page.getByText("Transcrições e processamento", { exact: true }).click();
	await expect(page.locator("details[open]").getByText("Herdada do projeto TDA", { exact: true }).first()).toBeVisible();
	await page.getByText("Mundo e narrativa", { exact: true }).click();
	await expect(page.locator("details[open]").getByText("Específica desta campanha", { exact: true }).first()).toBeVisible();
});

test("A-only, B-only and project-wide contexts never invent a hidden campaign", async ({
	page,
}) => {
	for (const fixture of [
		{ mode: "a-only", name: "Destino Sem Fim" },
		{
			mode: "b-only",
			name: "Passos Retomados — nome sintético deliberadamente comprido para reflow",
		},
	] as const) {
		await page.goto(`/e2e-fixtures/account-overview?mode=${fixture.mode}`);
		await expect(
			page
				.locator('[data-account-campaign-summary="true"]')
				.getByText(fixture.name, { exact: true }),
		).toBeVisible();
		await expect(page.getByRole("button", { name: "Campanha consultada" })).toHaveCount(0);
		await expect(page.locator("body")).not.toContainText("private-undiscovered");
	}

	await page.goto(
		"/e2e-fixtures/account-overview?mode=project-wide&campanha=passos-retomados",
	);
	await expect(
		page.getByText(
			"Este acesso é herdado do projeto TDA e vale para esta campanha enquanto os grants do projeto estiverem ativos.",
			{ exact: true },
		),
	).toBeVisible();
	await page.getByText("Administração", { exact: true }).click();
	const administration = page.locator("details[open]").filter({ hasText: "Administração" });
	await expect(administration.getByText("Herdada do projeto TDA", { exact: true }).first()).toBeVisible();
});

test("revocation and dependency failure remain distinguishable after reload", async ({
	page,
}) => {
	await page.goto("/e2e-fixtures/account-overview?mode=a-only");
	await expect(
		page
			.locator('[data-account-campaign-summary="true"]')
			.getByText("Destino Sem Fim", { exact: true }),
	).toBeVisible();

	await page.goto("/e2e-fixtures/account-overview?mode=none");
	await expect(
		page.getByText("Nenhuma permissão efetiva está ativa para esta conta.", {
			exact: true,
		}),
	).toBeVisible();
	await expect(page.getByText("Destino Sem Fim", { exact: true })).toHaveCount(0);

	await page.goto("/e2e-fixtures/account-overview?mode=unavailable");
	await expect(
		page.getByText(
			"Não foi possível verificar agora quais campanhas esta conta pode consultar.",
			{ exact: false },
		),
	).toBeVisible();
	await expect(
		page.getByText("Nenhuma permissão efetiva está ativa para esta conta.", {
			exact: true,
		}),
	).toHaveCount(0);
});

test("denied account state exposes only the sanitized internal retry target", async ({
	page,
}) => {
	await page.goto("/e2e-fixtures/account-overview?state=denied");
	const retry = page.getByRole("link", { name: "Tentar abrir novamente" });
	await expect(retry).toBeVisible();
	await expect(retry).toHaveAttribute("href", "/edit/mundo");
	await expect(page.locator("body")).not.toContainText("evil.test");
});

test("long campaign context reflows at mobile and the 200 percent proxy", async ({
	page,
}) => {
	for (const viewport of [
		{ width: 320, height: 800 },
		{ width: 390, height: 844 },
		{ width: 683, height: 384 },
		{ width: 1366, height: 768 },
	]) {
		await page.setViewportSize(viewport);
		await page.goto(
			"/e2e-fixtures/account-overview?mode=multi&campanha=passos-retomados",
		);
		await expect(
			page
				.locator('[data-account-campaign-summary="true"]')
				.getByText(
					"Passos Retomados — nome sintético deliberadamente comprido para reflow",
					{ exact: true },
				),
		).toBeVisible();
		await expectNoHorizontalOverflow(page);
	}

	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/e2e-fixtures/account-overview?mode=multi");
	const selector = page.getByRole("button", { name: "Campanha consultada" });
	await selector.focus();
	await expect(selector).toBeFocused();
	await page.keyboard.press("Enter");
	const listbox = page.getByRole("listbox", { name: "Campanha consultada" });
	await expect(listbox).toBeVisible();
	await listbox
		.getByRole("option", {
			name: "Passos Retomados — nome sintético deliberadamente comprido para reflow",
			exact: true,
		})
		.click();
	await expect(page).toHaveURL(/campanha=passos-retomados/u);
	await expect(
		page
			.locator('[data-account-campaign-summary="true"]')
			.getByText(
				"Passos Retomados — nome sintético deliberadamente comprido para reflow",
				{ exact: true },
			),
	).toBeVisible();
});
