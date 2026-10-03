import { expect, test } from "@playwright/test";

test("public campaign directory exposes only the synthetic public projection", async ({
	page,
}) => {
	await page.goto("/campanhas");

	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Campanhas");
	const cards = page.locator("article");
	await expect(cards).toHaveCount(2);
	await expect(cards.first()).toHaveAttribute(
		"data-campaign-route",
		"cronicas-da-mesa",
	);
	await expect(
		cards.first().locator("[data-campaign-artwork-source]"),
	).toHaveAttribute("data-campaign-artwork-source", "campaign-cover");
	await expect(
		cards.nth(1).locator("[data-campaign-artwork-source]"),
	).toHaveAttribute("data-campaign-artwork-source", "latest-session-hero");
	await expect(page.getByText("Fixture privada", { exact: true })).toHaveCount(0);
	await expect(page.getByText("Fixture arquivada", { exact: true })).toHaveCount(0);
	const firstCardBox = await cards.first().boundingBox();
	expect(firstCardBox).not.toBeNull();
	expect(firstCardBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(600);
	await expect(page.getByRole("heading", { name: "Crônicas da Mesa" })).toBeVisible();
	await expect(
		page.getByRole("heading", {
			name: "Antes que seja tarde — uma campanha com nome deliberadamente comprido",
		}),
	).toBeVisible();

	const links = page.getByRole("link", { name: /Abrir campanha/u });
	await expect(links).toHaveCount(2);
	await expect(links.nth(0)).toHaveAttribute(
		"href",
		"/campanhas/cronicas-da-mesa",
	);
	await expect(links.nth(1)).toHaveAttribute(
		"href",
		"/campanhas/antes-que-seja-tarde",
	);
	const sessionShortcuts = cards.getByRole("link", { name: "Sessões", exact: true });
	await expect(sessionShortcuts).toHaveCount(2);
	await expect(sessionShortcuts.nth(0)).toHaveAttribute(
		"href",
		"/campanhas/cronicas-da-mesa/sessoes",
	);
	await expect(sessionShortcuts.nth(1)).toHaveAttribute(
		"href",
		"/campanhas/antes-que-seja-tarde/sessoes",
	);
});

test("campaign cards open a campaign-qualified archive without leaking sibling sessions", async ({
	page,
}) => {
	await page.goto("/campanhas");

	await page
		.getByRole("article")
		.filter({ hasText: "Antes que seja tarde" })
		.getByRole("link", { name: /Abrir campanha/u })
		.click();

	await expect(page).toHaveURL(
		/\/campanhas\/antes-que-seja-tarde$/u,
	);
	await page.getByRole("link", { name: "Ver sessões" }).click();
	await expect(page).toHaveURL(
		/\/campanhas\/antes-que-seja-tarde\/sessoes$/u,
	);
	await expect(
		page.getByRole("heading", {
			level: 1,
			name: /Antes que seja tarde/u,
		}),
	).toBeVisible();
	await expect(page.locator("[data-session-card]")).toHaveCount(1);
	await expect(
		page.getByRole("heading", {
			name: "A memória global mais recente vem da campanha B",
		}),
	).toBeVisible();
	await expect(
		page.getByRole("heading", {
			name: "A memória mais recente do arquivo sintético",
		}),
	).toHaveCount(0);

	await page.goto("/campanhas/cronicas-da-mesa/sessoes");
	await expect(page.locator("[data-session-card]")).toHaveCount(3);
	await expect(
		page.getByRole("heading", {
			name: "A memória mais recente do arquivo sintético",
		}),
	).toBeVisible();
	await expect(
		page.getByRole("heading", {
			name: "A memória global mais recente vem da campanha B",
		}),
	).toHaveCount(0);
});

test("campaign directory remains keyboard reachable and free of horizontal overflow at mobile and 200% zoom", async ({
	page,
}) => {
	await page.setViewportSize({ width: 320, height: 800 });
	await page.goto("/campanhas");

	await page.keyboard.press("Tab");
	const firstArchiveLink = page.getByRole("link", { name: /Abrir campanha/u }).first();
	await firstArchiveLink.focus();
	await expect(firstArchiveLink).toBeFocused();

	const mobileOverflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
	);
	expect(mobileOverflow).toBeLessThanOrEqual(1);

	// Browser zoom reduces the CSS viewport. Model a 1920×1080 desktop at
	// 200% zoom as a 960×540 CSS viewport. Going below the product-wide
	// 320px minimum would test an unsupported viewport rather than zoom.
	await page.setViewportSize({ width: 960, height: 540 });
	const zoomOverflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
	);
	expect(zoomOverflow).toBeLessThanOrEqual(1);
});

const WORLD_A_PATH = "/campanhas/cronicas-da-mesa/mundo";
const WORLD_B_PATH = "/campanhas/antes-que-seja-tarde/mundo";

test("World campaign switch preserves explicit context across back, forward and reload", async ({
	page,
}) => {
	await page.goto(WORLD_A_PATH);
	await expect(
		page.locator('[data-world-edit-state][data-world-campaign="yuhara-main"]'),
	).toBeVisible();
	await expect(page.locator('[data-world-node="dandelion"]')).toBeVisible();

	const navigationClose = page.getByRole("button", {
		name: "Recolher navegação do mundo",
	});
	if (await navigationClose.isVisible().catch(() => false)) {
		await navigationClose.click();
	}
	const campaignSwitch = page.getByText("Trocar", { exact: true });
	await campaignSwitch.focus();
	await expect(campaignSwitch).toBeFocused();
	await page.keyboard.press("Enter");
	const campaignB = page.getByRole("link", {
		name: /^Antes que seja tarde/u,
	});
	await expect(campaignB).toHaveAttribute("href", WORLD_B_PATH);
	await campaignB.focus();
	await expect(campaignB).toBeFocused();
	await page.keyboard.press("Enter");

	await expect(page).toHaveURL(/\/campanhas\/antes-que-seja-tarde\/mundo$/u);
	await expect(page.locator('[data-world-empty="true"]')).toBeVisible();
	await expect(page.locator('[data-world-node="dandelion"]')).toHaveCount(0);

	await page.goBack();
	await expect(page).toHaveURL(/\/campanhas\/cronicas-da-mesa\/mundo$/u);
	await expect(
		page.locator('[data-world-edit-state][data-world-campaign="yuhara-main"]'),
	).toBeVisible();
	await expect(page.locator('[data-world-node="dandelion"]')).toBeVisible();

	await page.goForward();
	await expect(page).toHaveURL(/\/campanhas\/antes-que-seja-tarde\/mundo$/u);
	await expect(page.locator('[data-world-empty="true"]')).toBeVisible();
	await expect(page.locator('[data-world-node="dandelion"]')).toHaveCount(0);

	await page.reload();
	await expect(page).toHaveURL(/\/campanhas\/antes-que-seja-tarde\/mundo$/u);
	await expect(page.locator('[data-world-empty="true"]')).toBeVisible();
	await expect(page.locator('[data-world-node="dandelion"]')).toHaveCount(0);
});


test("aggregate and campaign-scoped session archives expose distinct product scope", async ({
	page,
}) => {
	await page.goto("/campanhas/sessoes");

	const aggregate = page.locator('[data-session-archive-scope="aggregate"]');
	await expect(aggregate).toBeVisible();
	await expect(
		aggregate.getByRole("heading", { level: 1, name: "Todas as campanhas" }),
	).toBeVisible();
	await expect(page.getByLabel("Filtrar por campanha")).toBeVisible();
	const campaignArchiveLinks = page.getByRole("navigation", {
		name: "Entrar no arquivo de uma campanha",
	});
	await expect(campaignArchiveLinks).toBeVisible();
	await expect(
		campaignArchiveLinks.getByRole("link", { name: "Crônicas da Mesa" }),
	).toHaveAttribute("href", "/campanhas/cronicas-da-mesa/sessoes");
	await expect(
		campaignArchiveLinks.getByRole("link", { name: /Antes que seja tarde/u }),
	).toHaveAttribute("href", "/campanhas/antes-que-seja-tarde/sessoes");
	await expect(
		page.locator('[data-session-card]').filter({ hasText: "Crônicas da Mesa" }).first(),
	).toBeVisible();
	await expect(
		page
			.locator('[data-session-card]')
			.filter({
				hasText:
					"Antes que seja tarde — uma campanha com nome deliberadamente comprido",
			})
			.first(),
	).toBeVisible();

	await page.getByRole("button", { name: "Visualização em lista" }).click();
	await expect(page.locator('[data-session-card="list"][data-campaign-route="cronicas-da-mesa"]').first()).toContainText(
		"Crônicas da Mesa",
	);
	await expect(page.locator('[data-session-card="list"][data-campaign-route="antes-que-seja-tarde"]').first()).toContainText(
		"Antes que seja tarde",
	);

	await page.goto("/campanhas/cronicas-da-mesa/sessoes");

	const scoped = page.locator('[data-session-archive-scope="campaign"]');
	await expect(scoped).toHaveAttribute("data-campaign-route", "cronicas-da-mesa");
	await expect(
		scoped.getByRole("heading", { level: 1, name: "Crônicas da Mesa" }),
	).toBeVisible();
	await expect(page.getByLabel("Filtrar por campanha")).toHaveCount(0);
	await expect(
		page.getByRole("link", { name: "Arquivo global" }),
	).toHaveAttribute("href", "/campanhas/sessoes");
	await expect(page.getByRole("link", { name: "Mundo" })).toHaveAttribute(
		"href",
		"/campanhas/cronicas-da-mesa/mundo",
	);
	await expect(page.getByRole("link", { name: "Personagens" })).toHaveAttribute(
		"href",
		"/campanhas/cronicas-da-mesa/personagens",
	);
	await expect(page.getByRole("link", { name: "Lugares" })).toHaveAttribute(
		"href",
		"/campanhas/cronicas-da-mesa/lugares",
	);
	await expect(page.locator("[data-session-archive-hero]")).toHaveAttribute(
		"data-campaign-artwork-source",
		"campaign-cover",
	);
	await expect(page.locator('[data-session-card]')).toHaveCount(3);
	await expect(
		page.getByRole("heading", {
			name: "A memória global mais recente vem da campanha B",
		}),
	).toHaveCount(0);
});

test("campaign archive keeps campaign context visible on narrow and zoom-equivalent viewports", async ({
	page,
}) => {
	await page.setViewportSize({ width: 320, height: 800 });
	await page.goto("/campanhas/cronicas-da-mesa/sessoes");

	await expect(page.getByRole("navigation", { name: "Contexto da campanha" })).toBeVisible();
	await expect(
		page.getByRole("link", { name: "Arquivo global" }),
	).toBeVisible();
	let overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
	);
	expect(overflow).toBeLessThanOrEqual(1);

	await page.setViewportSize({ width: 960, height: 540 });
	overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
	);
	expect(overflow).toBeLessThanOrEqual(1);
	await expect(page.getByText("Campanha · arquivo de sessões")).toBeVisible();
});


test("aggregate campaign filter hides for one campaign and keeps all 13 sessions", async ({
	page,
}) => {
	await page.goto("/e2e-fixtures/session-archive-scope");

	const fixture = page.locator('[data-session-scope-fixture="one-campaign"]');
	await expect(fixture.getByLabel("Filtrar por campanha")).toHaveCount(0);
	await expect(fixture.locator('[data-session-card="grid"]')).toHaveCount(13);
	await expect(
		fixture.getByRole("navigation", {
			name: "Entrar no arquivo de uma campanha",
		}),
	).toContainText("Campanha Única de Teste");

	await fixture.getByRole("button", { name: "Visualização em lista" }).click();
	await expect(fixture.locator('[data-session-card="list"]')).toHaveCount(13);
	await expect(fixture.locator('[data-session-card="list"]').first()).toContainText(
		"Campanha Única de Teste",
	);
});

test("aggregate filter keeps a zero-session campaign selectable while a sibling has content", async ({
	page,
}) => {
	await page.goto("/e2e-fixtures/session-archive-scope");

	const fixture = page.locator('[data-session-scope-fixture="empty-campaign"]');
	const campaignFilter = fixture.getByLabel("Filtrar por campanha");
	await expect(campaignFilter).toBeVisible();
	await expect(campaignFilter.locator("option")).toHaveCount(3);

	await campaignFilter.selectOption("fixture-only-campaign");
	await expect(fixture.locator("[data-session-card]")).toHaveCount(0);
	await expect(fixture).toContainText("Nenhuma sessão por aqui.");

	await campaignFilter.selectOption("fixture-with-content");
	await expect(fixture.locator('[data-session-card="grid"]')).toHaveCount(1);
	await expect(fixture.locator('[data-session-card="grid"]').first()).toHaveAttribute(
		"data-campaign-route",
		"fixture-with-content",
	);
});

test("campaign archive aliases, direct links and history preserve canonical scope", async ({
	page,
}) => {
	const alias = await page.request.get(
		"/campanhas/cronicas-da-mesa-antiga/sessoes",
		{ maxRedirects: 0 },
	);
	expect(alias.status()).toBe(307);
	const location = alias.headers().location;
	expect(location).toBeTruthy();
	expect(new URL(location!, "http://127.0.0.1:3106").pathname).toBe(
		"/campanhas/cronicas-da-mesa/sessoes",
	);

	await page.goto("/campanhas/sessoes");
	await page
		.getByRole("navigation", { name: "Entrar no arquivo de uma campanha" })
		.getByRole("link", { name: "Crônicas da Mesa" })
		.click();
	await expect(page).toHaveURL(/\/campanhas\/cronicas-da-mesa\/sessoes$/u);
	await expect(
		page.locator('[data-session-archive-scope="campaign"]'),
	).toHaveAttribute("data-campaign-route", "cronicas-da-mesa");

	await page.goBack();
	await expect(page).toHaveURL(/\/campanhas\/sessoes$/u);
	await expect(page.locator('[data-session-archive-scope="aggregate"]')).toBeVisible();

	await page.goForward();
	await expect(page).toHaveURL(/\/campanhas\/cronicas-da-mesa\/sessoes$/u);
	await expect(
		page.locator('[data-session-archive-scope="campaign"]'),
	).toHaveAttribute("data-campaign-route", "cronicas-da-mesa");
});


test("aggregate controls preserve campaign-qualified identity and scoped controls never leak sibling content", async ({
	page,
}) => {
	await page.goto("/campanhas/sessoes");

	const collisions = page.locator('[data-session-key$=":shared-session"]');
	await expect(collisions).toHaveCount(2);
	await expect(
		page.locator(
			'[data-session-key="cronicas-da-mesa:shared-session"][data-campaign-route="cronicas-da-mesa"]',
		),
	).toBeVisible();
	await expect(
		page.locator(
			'[data-session-key="antes-que-seja-tarde:shared-session"][data-campaign-route="antes-que-seja-tarde"]',
		),
	).toBeVisible();

	const aggregateArc = page.getByLabel("Filtrar por arco");
	const contractArcOptions = (await aggregateArc.locator("option").allTextContents()).filter(
		(label) => label.includes("Contrato visual E2E"),
	);
	expect(contractArcOptions).toEqual(
		expect.arrayContaining([
			"Contrato visual E2E — Crônicas da Mesa",
			"Contrato visual E2E — Antes que seja tarde — uma campanha com nome deliberadamente comprido",
		]),
	);
	expect(contractArcOptions).toHaveLength(2);

	await aggregateArc.selectOption({ label: "Contrato visual E2E — Crônicas da Mesa" });
	await expect(page.locator('[data-session-card="grid"]')).toHaveCount(3);

	await page
		.getByLabel("Filtrar por campanha")
		.selectOption("antes-que-seja-tarde");
	await expect(page.locator('[data-session-card="grid"]')).toHaveCount(1);
	await expect(page.locator('[data-session-card="grid"]').first()).toHaveAttribute(
		"data-campaign-route",
		"antes-que-seja-tarde",
	);

	await page.getByLabel("Ordenar por").selectOption("title");
	await expect(page.locator('[data-session-card="grid"]')).toHaveCount(1);

	await page.goto("/campanhas/cronicas-da-mesa/sessoes");
	await page.getByLabel("Buscar sessões").fill("campanha B");
	await expect(page.locator("[data-session-card]")).toHaveCount(0);

	await page.getByRole("button", { name: "Limpar filtros" }).click();
	await page.getByLabel("Ordenar por").selectOption("oldest");
	const campaignRoutes = await page
		.locator('[data-session-card="grid"]')
		.evaluateAll((nodes) =>
			Array.from(
				new Set(nodes.map((node) => node.getAttribute("data-campaign-route"))),
			),
		);
	expect(campaignRoutes).toEqual(["cronicas-da-mesa"]);
});

test("canonical campaign root keeps public context, useful actions and verified scoped content", async ({
	page,
}) => {
	await page.goto("/campanhas/cronicas-da-mesa");

	const root = page.locator('[data-campaign-root][data-campaign-route="cronicas-da-mesa"]');
	await expect(root).toBeVisible();
	await expect(root.getByRole("heading", { level: 1 })).toHaveText("Crônicas da Mesa");
	await expect(root).toHaveAttribute("data-campaign-artwork-source", "campaign-cover");
	await expect(root.getByRole("link", { name: "Ver sessões" })).toHaveAttribute(
		"href",
		"/campanhas/cronicas-da-mesa/sessoes",
	);
	await expect(root.getByRole("link", { name: "Explorar Mundo" })).toHaveAttribute(
		"href",
		"/campanhas/cronicas-da-mesa/mundo",
	);
	await expect(root.getByRole("link", { name: "Personagens" })).toHaveAttribute(
		"href",
		"/campanhas/cronicas-da-mesa/personagens",
	);
	await expect(root.getByRole("link", { name: /^Lugares\b/u })).toHaveAttribute(
		"href",
		"/campanhas/cronicas-da-mesa/lugares",
	);
	await expect(root.locator('[data-campaign-latest-session="shared-session"]')).toContainText(
		"A memória mais recente do arquivo sintético",
	);
	await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
		"href",
		/\/campanhas\/cronicas-da-mesa$/u,
	);

	await root.getByRole("link", { name: "Ver sessões" }).click();
	await expect(page).toHaveURL(/\/campanhas\/cronicas-da-mesa\/sessoes$/u);
	await expect(
		page.getByRole("navigation", { name: "Contexto da campanha" }).getByRole("link", {
			name: "Crônicas da Mesa",
		}),
	).toHaveAttribute("href", "/campanhas/cronicas-da-mesa");

	await page.goBack();
	await expect(page).toHaveURL(/\/campanhas\/cronicas-da-mesa$/u);
	await expect(
		page.locator('[data-campaign-root][data-campaign-route="cronicas-da-mesa"]'),
	).toBeVisible();
});

test("campaign roots never inherit a sibling highlight or narrative availability", async ({
	page,
}) => {
	await page.goto("/campanhas/antes-que-seja-tarde");

	const root = page.locator(
		'[data-campaign-root][data-campaign-route="antes-que-seja-tarde"]',
	);
	await expect(root).toBeVisible();
	await expect(root.getByRole("heading", { level: 1 })).toHaveText(
		"Antes que seja tarde — uma campanha com nome deliberadamente comprido",
	);
	await expect(root).toHaveAttribute("data-campaign-artwork-source", "session-artwork");
	await expect(root.locator('[data-campaign-latest-session="shared-session"]')).toContainText(
		"A memória global mais recente vem da campanha B",
	);
	await expect(root.getByText("A memória mais recente do arquivo sintético")).toHaveCount(0);
	await expect(root.getByRole("link", { name: "Personagens" })).toHaveCount(0);
	await expect(root.getByRole("link", { name: /^Lugares\b/u })).toHaveCount(0);
	await expect(root).toContainText(
		"Nenhum outro arquivo narrativo público foi vinculado a esta campanha ainda.",
	);
});

test("campaign root aliases canonicalize while private, archived and unknown routes fail closed", async ({
	page,
}) => {
	const alias = await page.request.get("/campanhas/cronicas-da-mesa-antiga", {
		maxRedirects: 0,
	});
	expect(alias.status()).toBe(308);
	expect(new URL(alias.headers().location!, "http://127.0.0.1").pathname).toBe(
		"/campanhas/cronicas-da-mesa",
	);

	for (const [path, secret] of [
		["/campanhas/fixture-private", "Fixture privada"],
		["/campanhas/fixture-archived", "Fixture arquivada"],
	] as const) {
		const response = await page.request.get(path, { maxRedirects: 0 });
		expect(response.status(), path).toBe(404);
		const body = await response.text();
		expect(body, path).not.toContain(secret);
		expect(body, path).toContain("Campanha pública do TDA.");
		expect(body, path).toContain("noindex, nofollow");
	}

	const unknown = await page.request.get("/campanhas/nao-existe", {
		maxRedirects: 0,
	});
	expect(unknown.status()).toBe(404);
	const unknownBody = await unknown.text();
	expect(unknownBody).toContain("Campanha pública do TDA.");
	expect(unknownBody).toContain("noindex, nofollow");
	expect(unknownBody).not.toContain("Fixture privada");
	expect(unknownBody).not.toContain("Fixture arquivada");
});

test("campaign root keeps first actions reachable without horizontal overflow on narrow and zoom-equivalent viewports", async ({
	page,
}) => {
	for (const viewport of [
		{ width: 320, height: 800, label: "320x800" },
		{ width: 390, height: 844, label: "390x844" },
		{ width: 960, height: 540, label: "200%-equivalent" },
		{ width: 1366, height: 768, label: "desktop" },
	] as const) {
		await page.setViewportSize({ width: viewport.width, height: viewport.height });
		await page.goto("/campanhas/cronicas-da-mesa");

		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
		);
		expect(overflow, viewport.label).toBeLessThanOrEqual(1);

		const action = page.getByRole("link", { name: "Ver sessões" });
		await action.focus();
		await expect(action, viewport.label).toBeFocused();
		const box = await action.boundingBox();
		expect(box, viewport.label).not.toBeNull();
		expect(box?.y ?? Number.POSITIVE_INFINITY, viewport.label).toBeLessThan(
			viewport.height,
		);
	}
});
