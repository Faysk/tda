import { expect, test } from "@playwright/test";

const worldLabels = [
	"Personagens",
	"NPCs",
	"Lugares",
	"Facções",
	"Quests",
	"Músicas",
	"Diários",
];

const allToolCapabilities = [
	"campaign.transcript.read",
	"campaign.local.process",
	"campaign.world.layout.edit",
	"narrative.review.read",
	"campaign.permissions.manage",
];

type NavigationState =
	| "anonymous"
	| "unavailable"
	| "authenticated_unlinked"
	| "authenticated_linked"
	| "authenticated_linked_no_grants";

type MockCampaign = Readonly<{
	technicalSlug: string;
	routeKey: string | null;
	name: string;
	lifecycle?: "active" | "archived";
	capabilities: readonly string[];
}>;

type MockAccessOptions = Readonly<{
	state?: NavigationState;
	capabilities?: readonly string[];
	campaigns?: readonly MockCampaign[];
	campaignsState?: "first_class" | "unavailable";
	identity?: Readonly<{
		displayName: string | null;
		avatarUrl: string | null;
	}> | null;
	status?: number;
}>;

async function mockAccess(
	page: import("@playwright/test").Page,
	options: MockAccessOptions = {},
) {
	const state = options.state ?? "authenticated_linked";
	const status = options.status ?? (state === "unavailable" ? 503 : 200);
	const authenticated =
		state === "authenticated_unlinked" ||
		state === "authenticated_linked" ||
		state === "authenticated_linked_no_grants";
	const capabilities = options.capabilities ?? [];
	const campaigns = (
		options.campaigns ??
		(authenticated && capabilities.length > 0
			? [
					{
						technicalSlug: "yuhara-main",
						routeKey: "cronicas-da-mesa",
						name: "Crônicas da Mesa",
						lifecycle: "active" as const,
						capabilities,
					},
				]
			: [])
	).map((campaign) => ({
		...campaign,
		lifecycle: campaign.lifecycle ?? ("active" as const),
	}));

	await page.route("**/api/auth/me", async (route) => {
		await route.fulfill({
			status,
			contentType: "application/json",
			body: JSON.stringify({
				state,
				scope: { type: "project", id: "tda" },
				...(authenticated
					? {
							identity:
								options.identity === undefined
									? { displayName: "Navegação Teste", avatarUrl: null }
									: options.identity,
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

async function openGlobalMenu(page: import("@playwright/test").Page) {
	const trigger = page.getByRole("button", { name: "Abrir menu global" });
	await trigger.click();
	await expect(trigger).toHaveAttribute("aria-expanded", "true");
	await expect(trigger).toHaveAttribute("aria-controls", "global-profile-menu");
	const panel = page.getByRole("region", { name: "Navegação, conta e aparência" });
	await expect(panel).toHaveAttribute("id", "global-profile-menu");
	return panel;
}

async function expectGlobalMenuVisuallySettled(page: import("@playwright/test").Page) {
	const panel = page.locator(".account-menu-panel");
	await expect(panel).toHaveAttribute("data-state", "open", { timeout: 3_000 });
	await expect
		.poll(
			async () =>
				Number.parseFloat(
					await panel.evaluate((element) => getComputedStyle(element).opacity),
				),
			{ timeout: 3_000 },
		)
		.toBeGreaterThanOrEqual(0.99);
}

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
}

async function expectPanelContained(page: import("@playwright/test").Page) {
	const viewport = page.viewportSize();
	expect(viewport).not.toBeNull();
	if (!viewport) return;
	const box = await page.locator(".account-menu-panel").boundingBox();
	expect(box).not.toBeNull();
	if (!box) return;
	expect(box.x).toBeGreaterThanOrEqual(-1);
	expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
	expect(box.y).toBeGreaterThanOrEqual(-1);
	expect(box.y).toBeLessThan(viewport.height);
}

test("avatar is the only global trigger and exposes hierarchical public IA", async ({ page }) => {
	await mockAccess(page);
	await page.goto("/personagens");
	await expect(page.getByRole("button", { name: "Abrir navegação" })).toHaveCount(0);
	await expect(page.locator(".product-launcher-trigger")).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Abrir menu global" })).toHaveCount(1);

	const panel = await openGlobalMenu(page);
	const navigation = panel.getByRole("navigation", { name: "Navegação principal" });
	for (const label of ["Campanhas", "Sessões", "Lores", "Lembra"]) {
		await expect(navigation.getByRole("link", { name: label, exact: true })).toBeVisible();
	}
	const world = navigation.getByRole("button", { name: "Mundo", exact: true });
	await expect(world).toBeVisible();
	await expect(world).toHaveAttribute("data-current", "true");
	for (const label of worldLabels) {
		await expect(navigation.getByRole("link", { name: label, exact: true })).toHaveCount(0);
	}

	await world.focus();
	await world.press("Enter");
	await expect(navigation.getByRole("heading", { name: "Mundo", exact: true })).toBeVisible();
	const back = navigation.getByRole("button", { name: "Voltar para Explorar", exact: true });
	await expect(back).toBeFocused();
	await expect(navigation.getByRole("link", { name: "Explorar tudo", exact: true })).toHaveAttribute("href", "/mundo");
	for (const label of worldLabels) {
		await expect(navigation.getByRole("link", { name: label, exact: true })).toBeVisible();
	}
	await expect(navigation.getByRole("link", { name: "Personagens", exact: true })).toHaveAttribute("aria-current", "page");

	await back.click();
	await expect(world).toBeFocused();
});

test("floating shell removes the structural top band and stays viewport-bound", async ({ page }) => {
	await mockAccess(page);
	await page.setViewportSize({ width: 1366, height: 768 });
	await page.goto("/");

	const shell = page.locator(".site-header");
	const brand = page.locator(".brand");
	const trigger = page.getByRole("button", { name: "Abrir menu global" });
	const [mainBox, brandBefore, triggerBefore] = await Promise.all([
		page.locator("main").boundingBox(),
		brand.boundingBox(),
		trigger.boundingBox(),
	]);
	expect(mainBox).not.toBeNull();
	expect(brandBefore).not.toBeNull();
	expect(triggerBefore).not.toBeNull();
	if (!mainBox || !brandBefore || !triggerBefore) return;

	expect(mainBox.y).toBeLessThanOrEqual(1);
	const shellStyle = await shell.evaluate((element) => {
		const style = getComputedStyle(element);
		return {
			position: style.position,
			height: Number.parseFloat(style.height),
			borderBottomWidth: style.borderBottomWidth,
			backgroundColor: style.backgroundColor,
		};
	});
	expect(shellStyle.position).toBe("fixed");
	expect(shellStyle.height).toBeLessThanOrEqual(1);
	expect(shellStyle.borderBottomWidth).toBe("0px");
	expect(shellStyle.backgroundColor).toBe("rgba(0, 0, 0, 0)");

	const scrims = await Promise.all([
		brand.evaluate((element) => getComputedStyle(element, "::before").backgroundImage),
		page.locator(".header-actions").evaluate(
			(element) => getComputedStyle(element, "::before").backgroundImage,
		),
	]);
	for (const backgroundImage of scrims) {
		expect(backgroundImage).toContain("radial-gradient");
	}

	await page.evaluate(() => {
		const spacer = document.createElement("div");
		spacer.dataset.testid = "floating-shell-scroll-spacer";
		spacer.style.height = "1600px";
		document.querySelector("main")?.append(spacer);
		window.scrollTo(0, 600);
	});
	await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
	const [brandAfter, triggerAfter] = await Promise.all([
		brand.boundingBox(),
		trigger.boundingBox(),
	]);
	expect(brandAfter).not.toBeNull();
	expect(triggerAfter).not.toBeNull();
	if (!brandAfter || !triggerAfter) return;
	expect(Math.abs(brandAfter.y - brandBefore.y)).toBeLessThanOrEqual(1);
	expect(Math.abs(triggerAfter.y - triggerBefore.y)).toBeLessThanOrEqual(1);
});

test("floating chrome stays near viewport corners beyond the content max width", async ({ page }) => {
	await mockAccess(page);
	await page.setViewportSize({ width: 3840, height: 2160 });
	await page.goto("/");

	const brand = await page.locator(".brand").boundingBox();
	const trigger = await page.getByRole("button", { name: "Abrir menu global" }).boundingBox();
	expect(brand).not.toBeNull();
	expect(trigger).not.toBeNull();
	if (!brand || !trigger) return;

	// The shell is viewport chrome, not a child of the 2160px content column.
	expect(brand.x).toBeLessThanOrEqual(100);
	expect(3840 - (trigger.x + trigger.width)).toBeLessThanOrEqual(100);
});

test("transparent floating shell does not steal pointer input from the free center area", async ({ page }) => {
	await mockAccess(page);
	await page.setViewportSize({ width: 1366, height: 768 });
	await page.goto("/");
	const hit = await page.evaluate(() => {
		const target = document.elementFromPoint(window.innerWidth / 2, 24);
		return {
			exists: target !== null,
			insideHeader: Boolean(target?.closest(".site-header")),
		};
	});
	expect(hit.exists).toBeTruthy();
	expect(hit.insideHeader).toBeFalsy();
});

test("root scroll clearance keeps focused anchors below the floating chrome", async ({ page }) => {
	await mockAccess(page);
	await page.setViewportSize({ width: 1366, height: 768 });
	await page.goto("/");
	const result = await page.evaluate(() => {
		const fixture = document.createElement("section");
		fixture.innerHTML = [
			'<div style="height: 1000px"></div>',
			'<button id="floating-shell-focus-probe" type="button">Focus probe</button>',
			'<div style="height: 1000px"></div>',
		].join("");
		const main = document.querySelector("main");
		if (!main) return null;
		main.append(fixture);

		const probe = document.getElementById("floating-shell-focus-probe");
		if (!(probe instanceof HTMLButtonElement)) {
			fixture.remove();
			return null;
		}
		probe.scrollIntoView({ block: "start" });
		probe.focus({ preventScroll: true });

		const brand = document.querySelector<HTMLElement>(".brand")?.getBoundingClientRect();
		const trigger = document
			.querySelector<HTMLElement>(".account-menu-trigger")
			?.getBoundingClientRect();
		const value = {
			focused: document.activeElement === probe,
			chromeBottom: Math.max(brand?.bottom ?? 0, trigger?.bottom ?? 0),
			probeTop: probe.getBoundingClientRect().top,
		};
		fixture.remove();
		return value;
	});
	expect(result).not.toBeNull();
	if (!result) return;
	expect(result.focused).toBeTruthy();
	expect(result.probeTop).toBeGreaterThanOrEqual(result.chromeBottom + 4);
});

test("home hero occupies the real top viewport across responsive breakpoints", async ({ page }) => {
	await mockAccess(page);
	for (const viewport of [
		{ width: 390, height: 844 },
		{ width: 1366, height: 768 },
		{ width: 2560, height: 1440 },
	]) {
		await page.setViewportSize(viewport);
		await page.goto("/");
		const hero = page.locator('main section[aria-labelledby="home-title"]').first();
		const box = await hero.boundingBox();
		expect(box).not.toBeNull();
		if (!box) continue;
		expect(box.y).toBeLessThanOrEqual(1);
		expect(box.height).toBeGreaterThanOrEqual(viewport.height - 1);
	}
});

test("profile panel stays anchored to the floating avatar after document scroll", async ({ page }) => {
	await mockAccess(page, { capabilities: allToolCapabilities });
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/");
	await page.evaluate(() => {
		const spacer = document.createElement("div");
		spacer.dataset.testid = "floating-shell-scroll-spacer";
		spacer.style.height = "1600px";
		document.querySelector("main")?.append(spacer);
		window.scrollTo(0, 600);
	});
	await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);

	const trigger = page.getByRole("button", { name: "Abrir menu global" });
	const triggerBox = await trigger.boundingBox();
	expect(triggerBox).not.toBeNull();
	const panel = await openGlobalMenu(page);
	await expectGlobalMenuVisuallySettled(page);
	const panelBox = await page.locator(".account-menu-panel").boundingBox();
	expect(panelBox).not.toBeNull();
	if (!triggerBox || !panelBox) return;

	const gap = panelBox.y - (triggerBox.y + triggerBox.height);
	expect(gap).toBeGreaterThanOrEqual(6);
	expect(gap).toBeLessThanOrEqual(16);
	await expectPanelContained(page);
	await expectNoHorizontalOverflow(page);
});

test("narrow public surfaces keep their first critical content clear of floating chrome", async ({ page }) => {
	await mockAccess(page);
	await page.setViewportSize({ width: 390, height: 844 });

	for (const route of ["/lore", "/diario", "/lembra"]) {
		await page.goto(route);
		const chromeBottom = await page.evaluate(() => {
			const brand = document.querySelector<HTMLElement>(".brand")?.getBoundingClientRect();
			const trigger = document
				.querySelector<HTMLElement>(".account-menu-trigger")
				?.getBoundingClientRect();
			return Math.max(brand?.bottom ?? 0, trigger?.bottom ?? 0);
		});

		const target =
			route === "/lembra"
				? page.getByPlaceholder("Buscar título, descrição, autor ou data...")
				: page.getByRole("heading", { level: 1 }).first();
		await expect(target).toBeVisible();
		const box = await target.boundingBox();
		expect(box).not.toBeNull();
		if (box) expect(box.y).toBeGreaterThanOrEqual(chromeBottom + 4);
		await expectNoHorizontalOverflow(page);
	}
});

test("World keeps floating global navigation without the retired header reveal control", async ({ page }) => {
	await mockAccess(page, { capabilities: allToolCapabilities });
	for (const viewport of [
		{ width: 1366, height: 768 },
		{ width: 390, height: 844 },
	]) {
		await page.setViewportSize(viewport);
		await page.goto("/mundo");

		await expect(page.getByRole("button", { name: "Mostrar menu principal" })).toHaveCount(0);
		const trigger = page.getByRole("button", { name: "Abrir menu global" });
		await expect(trigger).toBeVisible();
		const workspace = page.getByTestId("world-workspace");
		const workspaceBox = await workspace.boundingBox();
		expect(workspaceBox).not.toBeNull();
		if (workspaceBox) {
			expect(workspaceBox.y).toBeLessThanOrEqual(1);
			expect(workspaceBox.height).toBeGreaterThanOrEqual(viewport.height - 1);
		}

		const panel = await openGlobalMenu(page);
		await expect(panel.getByText("Explorar", { exact: true })).toBeVisible();
		await expectPanelContained(page);
		await page.keyboard.press("Escape");
	}
});

test("tools section projects only authorized launcher cells", async ({ page }) => {
	await mockAccess(page, { capabilities: ["campaign.transcript.read", "campaign.local.process", "campaign.permissions.manage"] });
	await page.goto("/");
	const panel = await openGlobalMenu(page);
	const navigation = panel.getByRole("navigation", { name: "Navegação principal" });
	const toolsSection = navigation.locator('[data-nav-section="tools"]');
	await expect(toolsSection.getByRole("heading", { name: "Ferramentas", exact: true })).toBeVisible();
	for (const label of ["Transcrições", "Editar sessões", "Processar", "Permissões"]) {
		await expect(toolsSection.getByRole("link", { name: label, exact: true })).toBeVisible();
	}
	await expect(toolsSection.getByRole("link", { name: "Editar mundo", exact: true })).toHaveCount(0);
	await expect(toolsSection.getByRole("link", { name: "Revisão", exact: true })).toHaveCount(0);
	await expect(navigation.getByRole("button", { name: "Ferramentas", exact: true })).toHaveCount(0);
});

test("broad capability projection exposes the complete authorized tool set on the root launcher", async ({ page }) => {
	await mockAccess(page, { capabilities: allToolCapabilities });
	await page.goto("/");
	const panel = await openGlobalMenu(page);
	const toolsSection = panel.locator('[data-nav-section="tools"]');
	for (const label of [
		"Transcrições",
		"Editar sessões",
		"Processar",
		"Editar mundo",
		"Revisão",
		"Permissões",
	]) {
		await expect(toolsSection.getByRole("link", { name: label, exact: true })).toBeVisible();
	}
});

test("public launcher exposes campaign directory and aggregate sessions as canonical destinations", async ({ page }) => {
	await mockAccess(page);
	await page.goto("/");
	const panel = await openGlobalMenu(page);
	const navigation = panel.getByRole("navigation", { name: "Navegação principal" });
	await expect(
		navigation.getByRole("link", { name: "Campanhas", exact: true }),
	).toHaveAttribute("href", "/campanhas");
	await expect(
		navigation.getByRole("link", { name: "Sessões", exact: true }),
	).toHaveAttribute("href", "/campanhas/sessoes");
});

test("multi-campaign tool launcher requires explicit context and never renders technical slugs as labels", async ({ page }) => {
	const longName =
		"Antes que seja tarde — uma campanha com um nome deliberadamente comprido para validar o seletor";
	await mockAccess(page, {
		campaigns: [
			{
				technicalSlug: "yuhara-main",
				routeKey: "cronicas-da-mesa",
				name: "Crônicas da Mesa",
				capabilities: allToolCapabilities,
			},
			{
				technicalSlug: "antes-que-seja-tarde",
				routeKey: "antes-que-seja-tarde",
				name: longName,
				capabilities: ["campaign.transcript.read"],
			},
			{
				technicalSlug: "mesa-do-norte",
				routeKey: "mesa-do-norte",
				name: "Mesa do Norte",
				capabilities: ["campaign.transcript.read"],
			},
		],
	});
	await page.setViewportSize({ width: 320, height: 800 });
	await page.goto("/");
	const panel = await openGlobalMenu(page);
	const toolsSection = panel.locator('[data-nav-section="tools"]');
	const selector = toolsSection.getByLabel("Campanha das ferramentas");
	await expect(selector).toHaveValue("");
	await expect(selector.locator("option")).toHaveText([
		"Escolha uma campanha",
		"Crônicas da Mesa",
		longName,
		"Mesa do Norte",
	]);
	await expect(toolsSection.getByText("yuhara-main", { exact: true })).toHaveCount(0);
	await expect(
		toolsSection.getByText("antes-que-seja-tarde", { exact: true }),
	).toHaveCount(0);
	await expect(
		toolsSection.getByText(
			"Escolha uma campanha para ver as ferramentas autorizadas.",
			{ exact: true },
		),
	).toBeVisible();
	await expect(
		panel.getByRole("link", { name: "Lembra", exact: true }),
	).toHaveAttribute("href", "/lembra");

	await expectGlobalMenuVisuallySettled(page);
	await selector.focus();
	await expect(selector).toBeFocused();
	expect(
		await selector.evaluate((element) => element.getBoundingClientRect().height),
	).toBeGreaterThanOrEqual(44);
	await selector.selectOption("antes-que-seja-tarde");
	await expect(
		toolsSection.getByRole("link", { name: "Transcrições", exact: true }),
	).toHaveAttribute(
		"href",
		"/edit/antes-que-seja-tarde/transcricoes",
	);
	await expect(
		toolsSection.getByRole("link", { name: "Permissões", exact: true }),
	).toHaveCount(0);
	await expect(
		toolsSection.getByRole("link", { name: "Editar sessões", exact: true }),
	).toHaveAttribute("href", "/edit/antes-que-seja-tarde/sessoes");
	for (const label of ["Processar", "Editar mundo", "Revisão"]) {
		await expect(
			toolsSection.getByRole("link", { name: label, exact: true }),
		).toHaveCount(0);
	}
	await expectNoHorizontalOverflow(page);
	await expectPanelContained(page);

	await selector.selectOption("yuhara-main");
	await expect(
		toolsSection.getByRole("link", { name: "Editar sessões", exact: true }),
	).toHaveAttribute("href", "/edit/yuhara-main/sessoes");
	await expect(
		toolsSection.getByRole("link", { name: "Revisão", exact: true }),
	).toHaveAttribute("href", "/edit/yuhara-main/revisao");
	await expect(
		toolsSection.getByRole("link", { name: "Permissões", exact: true }),
	).toHaveAttribute("href", "/edit/yuhara-main/permissions");
});

test("campaign-scoped public routes select the matching tool context and keep current-route state unambiguous", async ({ page }) => {
	await mockAccess(page, {
		campaigns: [
			{
				technicalSlug: "yuhara-main",
				routeKey: "cronicas-da-mesa",
				name: "Crônicas da Mesa",
				capabilities: ["campaign.permissions.manage"],
			},
			{
				technicalSlug: "antes-que-seja-tarde",
				routeKey: "antes-que-seja-tarde",
				name: "Antes que seja tarde",
				capabilities: ["campaign.permissions.manage"],
			},
		],
	});
	await page.goto("/campanhas/antes-que-seja-tarde/sessoes");
	const panel = await openGlobalMenu(page);
	const navigation = panel.getByRole("navigation", { name: "Navegação principal" });
	await expect(
		navigation.getByRole("link", { name: "Sessões", exact: true }),
	).toHaveAttribute("aria-current", "page");
	await expect(
		navigation.getByRole("link", { name: "Campanhas", exact: true }),
	).not.toHaveAttribute("aria-current", "page");
	const selector = panel.getByLabel("Campanha das ferramentas");
	await expect(selector).toHaveValue("antes-que-seja-tarde");
	await expect(
		panel.getByRole("link", { name: "Permissões", exact: true }),
	).toHaveAttribute("href", "/edit/antes-que-seja-tarde/permissions");
});

test("browser history restores the campaign context from scoped public routes", async ({ page }) => {
	await mockAccess(page, {
		campaigns: [
			{
				technicalSlug: "yuhara-main",
				routeKey: "cronicas-da-mesa",
				name: "Crônicas da Mesa",
				capabilities: ["campaign.permissions.manage"],
			},
			{
				technicalSlug: "antes-que-seja-tarde",
				routeKey: "antes-que-seja-tarde",
				name: "Antes que seja tarde",
				capabilities: ["campaign.permissions.manage"],
			},
		],
	});
	await page.goto("/campanhas/cronicas-da-mesa/sessoes");
	await page.goto("/campanhas/antes-que-seja-tarde/sessoes");

	await page.goBack();
	let panel = await openGlobalMenu(page);
	await expect(panel.getByLabel("Campanha das ferramentas")).toHaveValue(
		"yuhara-main",
	);
	await page.keyboard.press("Escape");

	await page.goForward();
	panel = await openGlobalMenu(page);
	await expect(panel.getByLabel("Campanha das ferramentas")).toHaveValue(
		"antes-que-seja-tarde",
	);
});

test("390 CSS px keeps the campaign launcher usable at the layout equivalent of 200 percent zoom", async ({ page }) => {
	await mockAccess(page, {
		campaigns: [
			{
				technicalSlug: "yuhara-main",
				routeKey: "cronicas-da-mesa",
				name: "Crônicas da Mesa",
				capabilities: allToolCapabilities,
			},
			{
				technicalSlug: "antes-que-seja-tarde",
				routeKey: "antes-que-seja-tarde",
				name: "Antes que seja tarde com um nome bastante comprido",
				capabilities: ["campaign.transcript.read"],
			},
		],
	});
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/");
	const panel = await openGlobalMenu(page);
	await expect(panel.getByLabel("Campanha das ferramentas")).toBeVisible();
	await expectPanelContained(page);
	await expectNoHorizontalOverflow(page);
});

test("tool launcher never invents an unauthorized sibling campaign", async ({ page }) => {
	await mockAccess(page, {
		campaigns: [
			{
				technicalSlug: "yuhara-main",
				routeKey: "cronicas-da-mesa",
				name: "Crônicas da Mesa",
				capabilities: ["campaign.permissions.manage"],
			},
		],
	});
	await page.goto("/");
	const panel = await openGlobalMenu(page);
	await expect(panel.getByText("Crônicas da Mesa", { exact: true })).toBeVisible();
	await expect(panel.getByText("Antes que seja tarde", { exact: true })).toHaveCount(0);
	await expect(
		panel.getByRole("link", { name: "Permissões", exact: true }),
	).toHaveAttribute("href", "/edit/yuhara-main/permissions");
});

test("anonymous unified panel keeps macro navigation, safe return path and appearance", async ({ page }) => {
	await mockAccess(page, { state: "anonymous" });
	await page.goto("/sessoes");
	const panel = await openGlobalMenu(page);
	await expect(panel.getByRole("button", { name: "Entrar com Discord" })).toBeVisible();
	await expect(panel.locator('input[name="next"]')).toHaveValue("/campanhas/sessoes");
	await expect(panel.getByRole("switch", { name: "Modo escuro" })).toBeVisible();
	await expect(panel.getByRole("button", { name: "Mundo", exact: true })).toBeVisible();
	await expect(panel.getByText("Ferramentas", { exact: true })).toHaveCount(0);
});

test("authenticated unified panel contains identity, account, appearance, navigation and logout", async ({ page }) => {
	await mockAccess(page, { state: "authenticated_linked_no_grants", identity: { displayName: "Pessoa Teste", avatarUrl: null } });
	await page.goto("/");
	await expect(page.locator(".account-avatar-initials")).toHaveText("PT");
	const panel = await openGlobalMenu(page);
	await expect(panel.getByText("Pessoa Teste", { exact: true })).toBeVisible();
	await expect(panel.getByRole("link", { name: "Conta e acesso" })).toHaveAttribute("href", "/conta");
	await expect(panel.getByRole("switch", { name: "Modo escuro" })).toBeVisible();
	await expect(panel.locator('form[action="/auth/logout"]')).toHaveAttribute("method", "post");
	await expect(panel.getByText("Ferramentas", { exact: true })).toHaveCount(0);
});

test("public navigation remains usable while auth projection is pending or unavailable", async ({ page }) => {
	let releaseAuth: (() => void) | undefined;
	const authReleased = new Promise<void>((resolve) => { releaseAuth = resolve; });
	await page.route("**/api/auth/me", async (route) => {
		await authReleased;
		await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
			state: "authenticated_linked",
			scope: { type: "project", id: "tda" },
			identity: { displayName: "Pessoa Teste", avatarUrl: null },
			capabilities: [],
			campaignsState: "first_class",
			campaigns: [{
				technicalSlug: "yuhara-main",
				routeKey: "cronicas-da-mesa",
				name: "Crônicas da Mesa",
				lifecycle: "active",
				capabilities: allToolCapabilities,
			}],
		}) });
	});
	await page.goto("/");
	const panel = await openGlobalMenu(page);
	await expect(panel.getByRole("link", { name: "Sessões", exact: true })).toBeVisible();
	await expect(panel.getByText("Ferramentas", { exact: true })).toHaveCount(0);
	releaseAuth?.();
	await expect(panel.getByText("Ferramentas", { exact: true })).toBeVisible();

	await page.reload();
});

test("unavailable auth never removes Explore or exposes private tools", async ({ page }) => {
	await mockAccess(page, { state: "unavailable", status: 503 });
	await page.goto("/");
	const panel = await openGlobalMenu(page);
	await expect(panel.getByText("Conta temporariamente indisponível", { exact: true })).toBeVisible();
	await expect(panel.getByText("Explorar", { exact: true })).toBeVisible();
	await expect(panel.getByRole("link", { name: "Sessões", exact: true })).toBeVisible();
	await expect(panel.getByText("Ferramentas", { exact: true })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Abrir menu global" })).toHaveCount(1);
});

test("keyboard, outside click and pathname changes dismiss the unified panel", async ({ page }) => {
	await mockAccess(page);
	await page.goto("/sessoes");
	const trigger = page.getByRole("button", { name: "Abrir menu global" });
	await trigger.focus();
	await page.keyboard.press("Enter");
	await expect(page.getByRole("region", { name: "Navegação, conta e aparência" })).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(trigger).toBeFocused();
	await page.keyboard.press("Space");
	// The mobile panel overlaps the heading; click the visible outside gutter.
	await page.mouse.click(2, (page.viewportSize()?.height ?? 800) - 2);
	await expect(trigger).toHaveAttribute("aria-expanded", "false");

	const panel = await openGlobalMenu(page);
	await panel.getByRole("link", { name: "Lores", exact: true }).click();
	await expect(page).toHaveURL(/\/lore$/u);
	await expect(trigger).toHaveAttribute("aria-expanded", "false");
	await expect(trigger).not.toBeFocused();
});

test("unified panel motion is reversible, inert while closing and unmounts after transition", async ({ page }) => {
	await mockAccess(page, { capabilities: allToolCapabilities });
	await page.goto("/");
	const trigger = page.getByRole("button", { name: "Abrir menu global" });
	await trigger.click();
	const panel = page.locator(".account-menu-panel");
	await expect(trigger).toHaveAttribute("aria-expanded", "true");
	await expect(panel).toHaveAttribute("data-state", /opening|open/u);
	const durations = await panel.evaluate((element) =>
		getComputedStyle(element).transitionDuration,
	);
	const seconds = durations
		.split(",")
		.map((value) => Number.parseFloat(value.trim()));
	expect(seconds.some((value) => value > 0)).toBeTruthy();
	expect(Math.max(...seconds)).toBeLessThan(0.6);

	await trigger.click();
	await expect(trigger).toHaveAttribute("aria-expanded", "false");
	await expect(panel).toHaveAttribute("data-state", "closing");
	await expect(panel).toHaveAttribute("aria-hidden", "true");
	expect(await panel.evaluate((element) => element.hasAttribute("inert"))).toBeTruthy();

	await trigger.click();
	await expect(trigger).toHaveAttribute("aria-expanded", "true");
	await expect(panel).toHaveCount(1);
	await expect(panel).toHaveAttribute("data-state", /opening|open/u);

	// The mobile panel overlaps the heading; click the visible outside gutter.
	await page.mouse.click(2, (page.viewportSize()?.height ?? 800) - 2);
	await expect(trigger).toHaveAttribute("aria-expanded", "false");
	await expect(panel).toHaveAttribute("data-state", "closing");
	await expect(panel).toHaveCount(0, { timeout: 3_000 });
});

test("closing global panel does not swallow Escape from the next top-layer interaction", async ({ page }) => {
	await mockAccess(page);
	await page.goto("/");
	const trigger = page.getByRole("button", { name: "Abrir menu global" });
	await trigger.click();
	await expect(trigger).toHaveAttribute("aria-expanded", "true");
	await trigger.click();
	await expect(trigger).toHaveAttribute("aria-expanded", "false");
	await expect(page.locator(".account-menu-panel")).toHaveAttribute("data-state", "closing");

	await page.evaluate(() => {
		const dialog = document.createElement("dialog");
		dialog.id = "navigation-escape-probe";
		dialog.textContent = "Escape probe";
		document.body.append(dialog);
		dialog.showModal();
	});
	const dialog = page.locator("#navigation-escape-probe");
	await expect(dialog).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(dialog).not.toBeVisible();
});

test("navigation action remains available during panel opening motion", async ({ page }) => {
	await mockAccess(page);
	await page.goto("/sessoes");
	const trigger = page.getByRole("button", { name: "Abrir menu global" });
	await trigger.click();
	const panel = page.getByRole("region", { name: "Navegação, conta e aparência" });
	await panel.getByRole("link", { name: "Lores", exact: true }).click({ timeout: 1_000 });
	await expect(page).toHaveURL(/\/lore$/u);
	await expect(trigger).toHaveAttribute("aria-expanded", "false");
});

test("rapid avatar toggles never create duplicate panels", async ({ page }) => {
	await mockAccess(page);
	await page.goto("/");
	const trigger = page.getByRole("button", { name: "Abrir menu global" });
	for (let index = 0; index < 5; index += 1) {
		await trigger.click();
	}
	await expect(page.locator(".account-menu-panel")).toHaveCount(1);
	await expect(trigger).toHaveAttribute("aria-expanded", "true");
});

test("reduced motion bypasses panel transition and unmounts immediately", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await mockAccess(page);
	await page.goto("/");
	const trigger = page.getByRole("button", { name: "Abrir menu global" });
	await trigger.click();
	const panel = page.locator(".account-menu-panel");
	await expect(panel).toHaveAttribute("data-state", "open");
	const durations = await panel.evaluate((element) =>
		getComputedStyle(element).transitionDuration,
	);
	expect(
		durations
			.split(",")
			.every((value) => Number.parseFloat(value.trim()) === 0),
	).toBeTruthy();
	await trigger.click();
	await expect(trigger).toHaveAttribute("aria-expanded", "false");
	await expect(panel).toHaveCount(0);
});

test("reduced motion also removes hierarchical drill-down animation", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await mockAccess(page, { capabilities: allToolCapabilities });
	await page.goto("/");
	const panel = await openGlobalMenu(page);
	await panel.getByRole("button", { name: "Mundo", exact: true }).click();
	const worldView = panel.locator('.global-nav-view[data-view="world"]');
	await expect(worldView).toBeVisible();
	const animation = await worldView.evaluate((element) => {
		const style = getComputedStyle(element);
		return { name: style.animationName, duration: style.animationDuration };
	});
	expect(animation.name).toBe("none");
	expect(animation.duration).toBe("0s");
});

test("unified panel keeps ordinary links, 44px trigger and no ARIA application menu roles", async ({ page }) => {
	await mockAccess(page, { capabilities: allToolCapabilities });
	await page.goto("/");
	const trigger = page.getByRole("button", { name: "Abrir menu global" });
	const box = await trigger.boundingBox();
	expect(box).not.toBeNull();
	if (box) {
		expect(box.width).toBeGreaterThanOrEqual(44);
		expect(box.height).toBeGreaterThanOrEqual(44);
	}
	await trigger.focus();
	const outline = await trigger.evaluate((element) => getComputedStyle(element).outlineStyle);
	expect(outline).not.toBe("none");
	const panel = await openGlobalMenu(page);
	await expect(panel.locator('[role="menu"], [role="menuitem"]')).toHaveCount(0);
});

test("skip link becomes visible on keyboard focus with and without reduced motion", async ({ page }) => {
	await mockAccess(page);
	for (const reducedMotion of ["no-preference", "reduce"] as const) {
		await page.emulateMedia({ reducedMotion });
		await page.goto("/");
		const skipLink = page.getByRole("link", { name: "Pular para o conteúdo" });
		await skipLink.focus();
		await expect(skipLink).toBeFocused();
		await expect
			.poll(async () => (await skipLink.boundingBox())?.y ?? Number.NEGATIVE_INFINITY)
			.toBeGreaterThanOrEqual(0);
	}
});

test("sectioned launcher keeps icon-first cells readable without card-heavy chrome", async ({ page }) => {
	await mockAccess(page, { capabilities: allToolCapabilities });
	await page.setViewportSize({ width: 1366, height: 768 });
	await page.goto("/");
	const panel = await openGlobalMenu(page);
	const world = panel.getByRole("button", { name: "Mundo", exact: true });
	const worldIcon = world.locator(".global-nav-cell-icon");
	const [cellBox, iconBox] = await Promise.all([world.boundingBox(), worldIcon.boundingBox()]);
	expect(cellBox).not.toBeNull();
	expect(iconBox).not.toBeNull();
	if (cellBox && iconBox) {
		expect(cellBox.height).toBeGreaterThanOrEqual(80);
		expect(cellBox.height).toBeLessThan(120);
		expect(iconBox.width).toBeGreaterThanOrEqual(30);
		expect(iconBox.height).toBeGreaterThanOrEqual(30);
	}

	for (const label of ["Editar sessões", "Transcrições", "Permissões"]) {
		const criticalLink = panel.getByRole("link", { name: label, exact: true });
		await expect(criticalLink).toBeVisible();
		expect(
			await criticalLink.locator(".global-nav-cell-label").evaluate(
				(element) => element.scrollWidth <= element.clientWidth + 1,
			),
		).toBeTruthy();
	}

	const sections = panel.locator("[data-nav-section]");
	await expect(sections).toHaveCount(3);
	const backgrounds = await sections.evaluateAll((elements) =>
		elements.map((element) => getComputedStyle(element).backgroundColor),
	);
	expect(new Set(backgrounds).size).toBeGreaterThanOrEqual(2);
});

test("sectioned launcher stays contained across the responsive matrix and preserves its grid contract", async ({ page }) => {
	await mockAccess(page, { capabilities: allToolCapabilities });
	await page.goto("/");
	for (const viewport of [
		{ width: 320, height: 800 },
		{ width: 390, height: 844 },
		{ width: 390, height: 500 },
		{ width: 768, height: 1024 },
		{ width: 683, height: 384 },
		{ width: 1366, height: 768 },
		{ width: 1920, height: 1080 },
		{ width: 2560, height: 1440 },
	]) {
		await page.setViewportSize(viewport);
		const panel = await openGlobalMenu(page);
		await expectNoHorizontalOverflow(page);
		await expectPanelContained(page);

		const explore = panel.locator('[data-nav-section="explore"]');
		const tools = panel.locator('[data-nav-section="tools"]');
		const utility = panel.locator('[data-nav-section="utility"]');
		await expect(explore).toBeVisible();
		await expect(tools).toBeVisible();
		await expect(utility).toBeVisible();

		for (const label of ["Sessões", "Lores", "Lembra"]) {
			await expect(explore.getByRole("link", { name: label, exact: true })).toBeVisible();
		}
		await expect(explore.getByRole("button", { name: "Mundo", exact: true })).toBeVisible();
		await expect(tools.getByRole("link", { name: "Editar sessões", exact: true })).toBeVisible();

		const columns = await explore.locator(".global-nav-grid").evaluate((element) =>
			getComputedStyle(element).gridTemplateColumns.split(" ").filter(Boolean).length,
		);
		expect(columns).toBe(viewport.width <= 360 ? 2 : 3);

		await explore.getByRole("button", { name: "Mundo", exact: true }).click();
		await expect(panel.getByRole("link", { name: "Personagens", exact: true })).toBeVisible();
		await expect(panel.getByRole("button", { name: "Voltar para Explorar", exact: true })).toBeFocused();
		expect(await panel.evaluate((element) => element.scrollTop)).toBeLessThanOrEqual(2);
		await expectNoHorizontalOverflow(page);
		await panel.getByRole("button", { name: "Voltar para Explorar", exact: true }).click();
		await expect(explore.getByRole("button", { name: "Mundo", exact: true })).toBeFocused();

		await page.keyboard.press("Escape");
	}
});

test("launcher owns one vertical scroll surface and keeps below-fold controls reachable", async ({ page }) => {
	await mockAccess(page, { capabilities: allToolCapabilities });
	await page.setViewportSize({ width: 390, height: 500 });
	await page.goto("/");
	const panel = await openGlobalMenu(page);
	const overflow = await panel.evaluate((element) => getComputedStyle(element).overflowY);
	expect(["auto", "scroll"]).toContain(overflow);

	const nestedScrollOwners = await panel.locator("[data-nav-section]").evaluateAll((elements) =>
		elements.filter((element) => {
			const style = getComputedStyle(element);
			return style.overflowY === "auto" || style.overflowY === "scroll";
		}).length,
	);
	expect(nestedScrollOwners).toBe(0);

	const logout = panel.getByRole("button", { name: "Sair", exact: true });
	await logout.scrollIntoViewIfNeeded();
	await logout.focus();
	await expect(logout).toBeFocused();
	const [panelBox, logoutBox] = await Promise.all([panel.boundingBox(), logout.boundingBox()]);
	expect(panelBox).not.toBeNull();
	expect(logoutBox).not.toBeNull();
	if (panelBox && logoutBox) {
		expect(logoutBox.y).toBeGreaterThanOrEqual(panelBox.y - 1);
		expect(logoutBox.y + logoutBox.height).toBeLessThanOrEqual(panelBox.y + panelBox.height + 1);
	}
});

test("appearance control toggles the explicit document theme", async ({ page }) => {
	await page.emulateMedia({ colorScheme: "dark" });
	await mockAccess(page, { state: "anonymous" });
	await page.goto("/");
	const panel = await openGlobalMenu(page);
	const theme = panel.getByRole("switch", { name: "Modo escuro" });
	await expect(theme).toHaveAttribute("aria-checked", "true");
	await theme.click();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("floating shell closed-state receipts capture the reclaimed viewport", async ({ page }, testInfo) => {
	await mockAccess(page, { capabilities: allToolCapabilities });
	for (const receipt of [
		{ name: "shell-home-desktop-dark", viewport: { width: 1920, height: 1080 }, colorScheme: "dark" as const },
		{ name: "shell-home-desktop-light", viewport: { width: 1920, height: 1080 }, colorScheme: "light" as const },
		{ name: "shell-home-mobile-dark", viewport: { width: 390, height: 844 }, colorScheme: "dark" as const },
		{ name: "shell-home-mobile-light", viewport: { width: 390, height: 844 }, colorScheme: "light" as const },
		{ name: "shell-home-4k-dark", viewport: { width: 3840, height: 2160 }, colorScheme: "dark" as const },
	]) {
		await page.setViewportSize(receipt.viewport);
		await page.emulateMedia({ colorScheme: receipt.colorScheme });
		await page.goto("/");
		await page.screenshot({
			path: testInfo.outputPath(`${receipt.name}.png`),
			fullPage: false,
		});
	}
});

test("floating chrome contrast receipts exercise opposing backgrounds without a full-width band", async ({ page }, testInfo) => {
	await mockAccess(page);
	await page.setViewportSize({ width: 1920, height: 1080 });

	for (const receipt of [
		{
			name: "shell-contrast-dark-theme",
			viewport: { width: 1920, height: 1080 },
			colorScheme: "dark" as const,
			background:
				"linear-gradient(90deg, #f4f1e8 0%, #f4f1e8 34%, #777 50%, #090b0e 66%, #090b0e 100%)",
		},
		{
			name: "shell-contrast-light-theme",
			viewport: { width: 1920, height: 1080 },
			colorScheme: "light" as const,
			background:
				"linear-gradient(90deg, #090b0e 0%, #090b0e 34%, #777 50%, #f4f1e8 66%, #f4f1e8 100%)",
		},
		{
			name: "shell-contrast-mobile-dark",
			viewport: { width: 390, height: 844 },
			colorScheme: "dark" as const,
			background:
				"linear-gradient(90deg, #f4f1e8 0%, #f4f1e8 48%, #090b0e 52%, #090b0e 100%)",
		},
		{
			name: "shell-contrast-mobile-light",
			viewport: { width: 390, height: 844 },
			colorScheme: "light" as const,
			background:
				"linear-gradient(90deg, #090b0e 0%, #090b0e 48%, #f4f1e8 52%, #f4f1e8 100%)",
		},
	]) {
		await page.setViewportSize(receipt.viewport);
		await page.emulateMedia({ colorScheme: receipt.colorScheme });
		await page.goto("/");
		await page.evaluate((background) => {
			const hero = document.querySelector<HTMLElement>(
				'main section[aria-labelledby="home-title"]',
			);
			if (!hero) return;
			hero.style.background = background;
			const artwork = hero.querySelector<HTMLElement>(
				':scope > div[aria-hidden="true"]',
			);
			if (artwork) artwork.style.display = "none";
		}, receipt.background);
		await page.screenshot({
			path: testInfo.outputPath(`${receipt.name}.png`),
			fullPage: false,
		});
	}
});

test("sectioned launcher captures World, capability and scrolled utility receipts", async ({ page }, testInfo) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.emulateMedia({ colorScheme: "dark" });
	await mockAccess(page, { capabilities: allToolCapabilities });
	await page.goto("/");
	let panel = await openGlobalMenu(page);
	await expectGlobalMenuVisuallySettled(page);
	await panel.getByRole("button", { name: "Mundo", exact: true }).click();
	await page.screenshot({
		path: testInfo.outputPath("navigation-world-mobile-dark.png"),
		fullPage: false,
	});
	await page.keyboard.press("Escape");

	await page.unroute("**/api/auth/me");
	await mockAccess(page, { capabilities: ["campaign.local.process"] });
	await page.reload();
	panel = await openGlobalMenu(page);
	await expect(panel.locator('[data-nav-section="tools"]')).toBeVisible();
	await page.screenshot({
		path: testInfo.outputPath("navigation-partial-tools-mobile-dark.png"),
		fullPage: false,
	});
	await page.keyboard.press("Escape");

	await page.unroute("**/api/auth/me");
	await mockAccess(page, { capabilities: allToolCapabilities });
	await page.setViewportSize({ width: 1366, height: 600 });
	await page.reload();
	panel = await openGlobalMenu(page);
	await panel.getByRole("button", { name: "Sair", exact: true }).scrollIntoViewIfNeeded();
	await page.screenshot({
		path: testInfo.outputPath("navigation-full-tools-utility-scrolled.png"),
		fullPage: false,
	});
});

test("desktop and mobile unified navigation receipts are captured from synthetic state", async ({ page }, testInfo) => {
	await mockAccess(page, { capabilities: allToolCapabilities });
	for (const receipt of [
		{ name: "desktop-dark", viewport: { width: 1920, height: 1080 }, colorScheme: "dark" as const },
		{ name: "desktop-light", viewport: { width: 1920, height: 1080 }, colorScheme: "light" as const },
		{ name: "mobile-dark", viewport: { width: 390, height: 844 }, colorScheme: "dark" as const },
		{ name: "mobile-light", viewport: { width: 390, height: 844 }, colorScheme: "light" as const },
	]) {
		await page.setViewportSize(receipt.viewport);
		await page.emulateMedia({ colorScheme: receipt.colorScheme });
		await page.goto("/");
		await openGlobalMenu(page);
		await expectGlobalMenuVisuallySettled(page);
		await page.screenshot({ path: testInfo.outputPath(`navigation-${receipt.name}.png`), fullPage: false });
	}
});

test("account overview keeps synthetic identity and access usable across the layout matrix", async ({
	page,
	context,
}, testInfo) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);

	for (const state of [
		{
			query: "anonymous",
			status: "Não autenticada",
			body: "Entre com o Discord para consultar seu vínculo TDA.",
		},
		{
			query: "unavailable",
			status: "Acesso indisponível",
			body: "Não foi possível consultar seu vínculo TDA agora.",
		},
		{
			query: "unlinked",
			status: "Não vinculada",
			body: "Esta conta do Discord ainda não tem um perfil TDA vinculado.",
		},
		{
			query: "no-grants",
			status: "Vinculada · sem permissões",
			body: "Nenhuma permissão efetiva nesta campanha.",
		},
	]) {
		await page.goto(`/e2e-fixtures/account-overview?state=${state.query}`);
		await expect(page.getByText(state.status, { exact: true })).toBeVisible();
		await expect(page.getByText(state.body, { exact: false })).toBeVisible();
		await expect(page.locator("body")).not.toContainText(
			"auth-synthetic-never-rendered",
		);
	}

	for (const viewport of [
		{ width: 320, height: 800 },
		{ width: 390, height: 844 },
		{ width: 768, height: 1024 },
		{ width: 1366, height: 768 },
		{ width: 1920, height: 1080 },
	]) {
		await page.setViewportSize(viewport);
		await page.goto("/e2e-fixtures/account-overview");
		await expect(
			page.getByRole("heading", { name: "Conta e acesso", exact: true }),
		).toBeVisible();
		await expect(page.getByText("Pessoa Sintética", { exact: true })).toBeVisible();
		const profileId = page.getByText("profile-tda-synthetic-927", { exact: true });
		await expect(profileId).toBeHidden();
		await expect(
			page.getByRole("heading", { name: "Acesso nesta campanha", exact: true }),
		).toBeVisible();
		await expect(page.getByRole("heading", { name: "Vínculo TDA", exact: true })).toBeVisible();
		await expect(page.getByRole("heading", { name: "Aparência", exact: true })).toBeVisible();
		await expect(page.getByText("Gerenciar permissões", { exact: true }).first()).toBeVisible();
		const technicalCapability = page.getByText("campaign.permissions.manage", { exact: true });
		await expect(technicalCapability).toBeHidden();
		await page.getByText("Detalhes técnicos do acesso", { exact: true }).click();
		await expect(technicalCapability).toBeVisible();
		await expect(page.getByText("campaign/yuhara-main", { exact: true })).toHaveCount(0);
		await expect(page.getByRole("link", { name: "Ver histórias públicas" })).toHaveCount(0);
		await expect(page.locator('main a[href^="/edit"], main a[href="/transcricoes"]')).toHaveCount(0);
		await expect(page.getByRole("switch", { name: "Modo escuro" })).toBeVisible();
		await expect(page.locator('form[action="/auth/logout"]')).toHaveAttribute("method", "post");
		await expectNoHorizontalOverflow(page);
	}

	await page.goto("/e2e-fixtures/account-overview?state=unavailable");
	await expect(page.locator('form[action="/auth/logout"]')).toHaveCount(0);
	await expect(page.getByRole("link", { name: "Tentar novamente" })).toBeVisible();

	await page.goto("/e2e-fixtures/account-overview?state=anonymous");
	await expect(page.locator('form[action="/auth/logout"]')).toHaveCount(0);
	await expect(page.getByRole("link", { name: "Entrar com Discord" })).toBeVisible();

	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/e2e-fixtures/account-overview");
	await page.getByText("Identificador do perfil", { exact: true }).click();
	const copyId = page.getByRole("button", { name: "Copiar ID" });
	await copyId.focus();
	await expect(copyId).toBeFocused();
	await copyId.press("Enter");
	await expect(page.getByText("ID copiado.", { exact: true })).toBeVisible();
	await copyId.click();
	await expect(page.getByText("ID copiado.", { exact: true })).toBeVisible();

	for (const receipt of [
		{
			name: "navigation-desktop-dark",
			viewport: { width: 1920, height: 1080 },
			colorScheme: "dark" as const,
		},
		{
			name: "navigation-desktop-light",
			viewport: { width: 1920, height: 1080 },
			colorScheme: "light" as const,
		},
		{
			name: "navigation-mobile-dark",
			viewport: { width: 390, height: 844 },
			colorScheme: "dark" as const,
		},
		{
			name: "navigation-mobile-light",
			viewport: { width: 390, height: 844 },
			colorScheme: "light" as const,
		},
	]) {
		await page.setViewportSize(receipt.viewport);
		await page.emulateMedia({ colorScheme: receipt.colorScheme });
		await page.goto("/e2e-fixtures/account-overview");
		await page.screenshot({
			path: testInfo.outputPath(`${receipt.name}.png`),
			fullPage: false,
		});
	}
});

