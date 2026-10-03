import { expect, test, type Locator, type Page } from "@playwright/test";

const CAMPAIGN_A = {
	route: "cronicas-da-mesa",
	technical: "yuhara-main",
	name: "Crônicas da Mesa",
} as const;
const CAMPAIGN_B = {
	route: "antes-que-seja-tarde",
	technical: "antes-que-seja-tarde",
	name: "Antes que seja tarde — uma campanha com nome deliberadamente comprido",
} as const;

const ALL_CAPABILITIES = [
	"campaign.transcript.read",
	"campaign.local.process",
	"campaign.world.layout.edit",
	"narrative.review.read",
	"campaign.permissions.manage",
] as const;

type MockCampaign = Readonly<{
	technicalSlug: string;
	routeKey: string;
	name: string;
	capabilities: readonly string[];
}>;

async function mockAccess(
	page: Page,
	options: Readonly<{
		state?:
			| "anonymous"
			| "unavailable"
			| "authenticated_linked"
			| "authenticated_linked_no_grants";
		campaignsState?: "first_class" | "unavailable";
		campaigns?: readonly MockCampaign[];
	}> = {},
) {
	const state = options.state ?? "authenticated_linked";
	const authenticated =
		state === "authenticated_linked" ||
		state === "authenticated_linked_no_grants";
	const campaigns = (options.campaigns ?? []).map((campaign) => ({
		...campaign,
		lifecycle: "active" as const,
	}));
	await page.route("**/api/auth/me", async (route) => {
		await route.fulfill({
			status: state === "unavailable" ? 503 : 200,
			contentType: "application/json",
			body: JSON.stringify({
				state,
				scope: { type: "project", id: "tda" },
				...(authenticated
					? {
							identity: { displayName: "Acceptance sintético", avatarUrl: null },
							capabilities: [],
							campaignsState: options.campaignsState ?? "first_class",
							campaigns,
						}
					: {
							campaignsState: state === "unavailable" ? "unavailable" : "none",
							campaigns: [],
						}),
			}),
		});
	});
}

async function openGlobalMenu(page: Page) {
	const trigger = page.getByRole("button", { name: "Abrir menu global" });
	await trigger.click();
	await expect(trigger).toHaveAttribute("aria-expanded", "true");
	return page.getByRole("region", { name: "Navegação, conta e aparência" });
}

async function expectNoHorizontalOverflow(page: Page, label: string) {
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
	);
	expect(overflow, `${label}: horizontal overflow`).toBeLessThanOrEqual(1);
}

async function expectDecodedImage(container: Locator, label: string) {
	const image = container.locator("img").first();
	await expect(image, `${label}: image element`).toBeVisible();
	await expect
		.poll(
			() =>
				image.evaluate((element) => {
					const img = element as HTMLImageElement;
					return img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;
				}),
			{ message: `${label}: published artwork must decode` },
		)
		.toBe(true);
}

test("[directory] A uses its cover, B uses latest-session artwork and private/archived C never leaks", async ({
	page,
}) => {
	await page.goto("/campanhas");
	const cards = page.locator("[data-campaign-card]");
	await expect(cards).toHaveCount(2);

	const a = cards.filter({ hasText: CAMPAIGN_A.name });
	await expect(a.locator("[data-campaign-artwork-source]")).toHaveAttribute(
		"data-campaign-artwork-source",
		"campaign-cover",
	);
	await expectDecodedImage(a.locator("[data-campaign-artwork-source]"), "campaign A cover");

	const b = cards.filter({ hasText: "Antes que seja tarde" });
	await expect(b.locator("[data-campaign-artwork-source]")).toHaveAttribute(
		"data-campaign-artwork-source",
		"latest-session-hero",
	);
	await expectDecodedImage(b.locator("[data-campaign-artwork-source]"), "campaign B session fallback");

	await expect(page.getByText("Fixture privada", { exact: true })).toHaveCount(0);
	await expect(page.getByText("Fixture arquivada", { exact: true })).toHaveCount(0);
	await expect(page.locator('[data-campaign-route="fixture-private"]')).toHaveCount(0);
	await expect(page.locator('[data-campaign-route="fixture-archived"]')).toHaveCount(0);
});

test("[sessions] aggregate and campaign-scoped archives expose different semantics and filters", async ({
	page,
}) => {
	await page.goto("/campanhas/sessoes");
	await expect(page.locator('[data-session-archive-scope="aggregate"]')).toBeVisible();
	await expect(page.getByText("Arquivo global", { exact: true })).toBeVisible();
	await expect(page.getByRole("heading", { level: 1, name: "Todas as campanhas" })).toBeVisible();
	await expect(
		page.getByRole("region", { name: "Sessões publicadas de todas as campanhas" }),
	).toBeVisible();
	await expect(page.locator("[data-session-card]")).toHaveCount(4);
	const filter = page.getByLabel("Filtrar por campanha");
	await expect(filter).toBeVisible();
	await expect(
		page.locator("[data-session-card]").filter({ hasText: CAMPAIGN_A.name }).first(),
	).toBeVisible();
	await expect(
		page.locator("[data-session-card]").filter({ hasText: CAMPAIGN_B.name }).first(),
	).toBeVisible();

	await filter.selectOption(CAMPAIGN_B.route);
	await expect(
		page.getByRole("heading", { name: "A memória global mais recente vem da campanha B" }),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "A memória mais recente do arquivo sintético" }),
	).toHaveCount(0);

	await page.goto(`/campanhas/${CAMPAIGN_A.route}/sessoes`);
	await expect(page.locator('[data-session-archive-scope="campaign"]')).toBeVisible();
	await expect(page.getByText("Campanha · arquivo de sessões", { exact: true })).toBeVisible();
	await expect(page.getByRole("heading", { level: 1, name: CAMPAIGN_A.name })).toBeVisible();
	await expect(page.getByLabel("Filtrar por campanha")).toHaveCount(0);
	await expect(page.locator("[data-session-card]")).toHaveCount(3);
	await expect(
		page.getByRole("heading", { name: "A memória global mais recente vem da campanha B" }),
	).toHaveCount(0);
});

test("[session reader] artwork health, breadcrumb and previous/next stay inside campaign A", async ({
	page,
}) => {
	await page.goto(
		`/campanhas/${CAMPAIGN_A.route}/sessoes/layout-contract-synthetic`,
	);
	const hero = page.locator("[data-session-reader-hero]");
	await expect(hero).toHaveAttribute("data-session-artwork-source", "cover");
	await expectDecodedImage(hero, "session cover");
	await expect(
		page.getByRole("link", { name: /Arquivo de Crônicas da Mesa/u }),
	).toHaveAttribute("href", `/campanhas/${CAMPAIGN_A.route}/sessoes`);

	const neighbors = page.locator('nav[aria-label="Navegação entre sessões"] a');
	for (let index = 0; index < (await neighbors.count()); index += 1) {
		await expect(neighbors.nth(index)).toHaveAttribute(
			"href",
			new RegExp(`^/campanhas/${CAMPAIGN_A.route}/sessoes/`, "u"),
		);
	}
	await expect(page.getByText("Antes que seja tarde", { exact: false })).toHaveCount(0);

	await page.goto(`/campanhas/${CAMPAIGN_A.route}/sessoes/shared-session`);
	const intentionalFallback = page.locator("[data-session-reader-hero]");
	await expect(intentionalFallback).toHaveAttribute(
		"data-session-artwork-source",
		"fallback",
	);
	await expect(intentionalFallback.locator("img")).toHaveCount(0);
});

test("[lore] catalogue identifies A and B while an explicitly unlinked curated lore stays standalone", async ({
	page,
}) => {
	await page.goto("/lore");
	await expect(page.locator('[data-lore-catalogue-mode="grouped"]')).toBeVisible();

	await expect(page.locator('[data-lore="astel"]')).toHaveAttribute(
		"data-lore-campaign",
		CAMPAIGN_A.route,
	);
	await expect(page.locator('[data-lore="pipipi"]')).toHaveAttribute(
		"data-lore-campaign",
		CAMPAIGN_B.route,
	);
	await expect(page.locator('[data-lore="seika"]')).toHaveAttribute(
		"data-lore-campaign",
		"standalone",
	);
	await expect(page.locator('[data-lore="seika"]')).not.toContainText(CAMPAIGN_A.name);
	await expect(page.locator('[data-lore="seika"]')).not.toContainText("Antes que seja tarde");
	await expect(page.locator("body")).not.toContainText("yuhara-main");

	for (const slug of ["astel", "pipipi", "seika"]) {
		await expect(page.locator(`[data-lore="${slug}"] a`)).toHaveAttribute(
			"href",
			`/lore/${slug}`,
		);
	}
	const response = await page.goto("/lore/seika");
	expect(response?.status(), "curated Seika route/listing parity").toBe(200);
});

test("[world] campaign B cannot inherit A nodes, edges or restored layout state", async ({
	page,
}) => {
	await page.goto(`/campanhas/${CAMPAIGN_A.route}/mundo`);
	await expect(page.locator('[data-world-node="dandelion"]')).toBeVisible();
	await expect(page.locator('[data-world-edge="astel-raven-queen"]')).toBeVisible();

	await page.goto(`/campanhas/${CAMPAIGN_B.route}/mundo`);
	await expect(page.locator('[data-world-empty="true"]')).toBeVisible();
	await expect(page.locator('[data-world-node="dandelion"]')).toHaveCount(0);
	await expect(page.locator('[data-world-edge="astel-raven-queen"]')).toHaveCount(0);
	await page.reload();
	await expect(page.locator('[data-world-node="dandelion"]')).toHaveCount(0);

	await page.goto(`/campanhas/${CAMPAIGN_A.route}/mundo`);
	await expect(page.locator('[data-world-node="dandelion"]')).toBeVisible();
	await expect(page.locator('[data-world-edge="astel-raven-queen"]')).toBeVisible();
});

test("[auth/Edit] A+B, A-only, anonymous and unavailable states remain fail-closed and distinguishable", async ({
	page,
}) => {
	await mockAccess(page, {
		campaigns: [
			{
				technicalSlug: CAMPAIGN_A.technical,
				routeKey: CAMPAIGN_A.route,
				name: CAMPAIGN_A.name,
				capabilities: ALL_CAPABILITIES,
			},
			{
				technicalSlug: CAMPAIGN_B.technical,
				routeKey: CAMPAIGN_B.route,
				name: CAMPAIGN_B.name,
				capabilities: ["campaign.transcript.read"],
			},
		],
	});
	await page.goto(`/campanhas/${CAMPAIGN_B.route}/sessoes`);
	let panel = await openGlobalMenu(page);
	const selector = panel.getByLabel("Campanha das ferramentas");
	await expect(selector).toHaveValue(CAMPAIGN_B.technical);
	await expect(panel.getByRole("link", { name: "Transcrições", exact: true })).toHaveAttribute(
		"href",
		`/edit/${CAMPAIGN_B.technical}/transcricoes`,
	);
	for (const label of ["Processar", "Editar mundo", "Revisão", "Permissões"]) {
		await expect(panel.getByRole("link", { name: label, exact: true })).toHaveCount(0);
	}

	await page.unroute("**/api/auth/me");
	await mockAccess(page, {
		campaigns: [
			{
				technicalSlug: CAMPAIGN_A.technical,
				routeKey: CAMPAIGN_A.route,
				name: CAMPAIGN_A.name,
				capabilities: ["campaign.permissions.manage"],
			},
		],
	});
	await page.reload();
	panel = await openGlobalMenu(page);
	await expect(panel.getByText(CAMPAIGN_B.name, { exact: true })).toHaveCount(0);
	await expect(panel.locator(`a[href^="/edit/${CAMPAIGN_B.technical}/"]`)).toHaveCount(0);

	await page.unroute("**/api/auth/me");
	await mockAccess(page, { state: "anonymous" });
	await page.reload();
	panel = await openGlobalMenu(page);
	await expect(panel.getByRole("button", { name: "Entrar com Discord" })).toBeVisible();
	await expect(panel.getByText("Ferramentas", { exact: true })).toHaveCount(0);

	await page.unroute("**/api/auth/me");
	await mockAccess(page, { campaignsState: "unavailable" });
	await page.reload();
	panel = await openGlobalMenu(page);
	await expect(
		panel.getByText("As campanhas do Edit estão temporariamente indisponíveis.", {
			exact: true,
		}),
	).toBeVisible();
	await expect(panel.getByText("Ferramentas", { exact: true })).toBeVisible();

	await page.unroute("**/api/auth/me");
	await mockAccess(page, {
		state: "authenticated_linked_no_grants",
		campaignsState: "first_class",
		campaigns: [],
	});
	await page.reload();
	panel = await openGlobalMenu(page);
	await expect(
		panel.getByText("As campanhas do Edit estão temporariamente indisponíveis.", {
			exact: true,
		}),
	).toHaveCount(0);
	await expect(panel.getByText("Ferramentas", { exact: true })).toHaveCount(0);
});

test("[reflow] fast acceptance covers 390px, 1366px and the governed 200% proxy without horizontal overflow", async ({
	page,
}) => {
	for (const viewport of [
		{ width: 390, height: 844, label: "390px" },
		{ width: 1366, height: 768, label: "1366px" },
		{ width: 683, height: 384, label: "200%-proxy" },
	] as const) {
		await page.setViewportSize(viewport);
		for (const route of [
			"/campanhas",
			"/campanhas/sessoes",
			`/campanhas/${CAMPAIGN_A.route}/sessoes`,
			"/lore",
		]) {
			await page.goto(route);
			await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
			await expectNoHorizontalOverflow(page, `${viewport.label} ${route}`);
		}
	}
});
