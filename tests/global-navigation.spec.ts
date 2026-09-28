import {
	expect,
	test,
	type Locator,
	type Page,
	type TestInfo,
} from "@playwright/test";

const publicDestinations = [
	["Sessões", "/sessoes"],
	["Lembra", "/lembra"],
	["Lores", "/lore"],
	["Mundo", "/mundo"],
	["Personagens", "/personagens"],
	["NPCs", "/npcs"],
	["Lugares", "/lugares"],
	["Facções", "/faccoes"],
	["Quests", "/quests"],
	["Músicas", "/musicas"],
	["Diários", "/diario"],
] as const;

const fullCapabilities = [
	"campaign.transcript.read",
	"campaign.local.process",
	"campaign.world.layout.edit",
	"narrative.review.read",
	"campaign.permissions.manage",
] as const;

type NavigationState =
	| "anonymous"
	| "unavailable"
	| "authenticated_unlinked"
	| "authenticated_linked"
	| "authenticated_linked_no_grants";

type ProjectionFixture = Readonly<{
	state?: NavigationState;
	status?: number;
	capabilities?: readonly string[];
	identity?: Readonly<{
		displayName: string | null;
		avatarUrl: string | null;
	}> | null;
}>;

const syntheticIdentity = {
	displayName: "Ada Navegadora",
	avatarUrl: null,
} as const;

const syntheticAvatar =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

async function mockAccess(
	page: Page,
	fixture: ProjectionFixture = {},
): Promise<void> {
	const state = fixture.state ?? "authenticated_linked";
	const status =
		fixture.status ?? (state === "unavailable" ? 503 : 200);
	const authenticated = state.startsWith("authenticated_");

	await page.route("**/api/auth/me", async (route) => {
		await route.fulfill({
			status,
			contentType: "application/json",
			headers: { "cache-control": "private, no-store" },
			body: JSON.stringify({
				state,
				scope: { type: "campaign", id: "yuhara-main" },
				identity: authenticated
					? fixture.identity ?? syntheticIdentity
					: undefined,
				capabilities: fixture.capabilities ?? [],
			}),
		});
	});
}

async function openLauncher(
	page: Page,
	via: "click" | "enter" | "space" = "click",
): Promise<Locator> {
	const trigger = page.getByRole("button", { name: "Abrir navegação" });
	if (via === "click") {
		await trigger.click();
	} else {
		await trigger.focus();
		await page.keyboard.press(via === "enter" ? "Enter" : "Space");
	}
	await expect(trigger).toHaveAttribute("aria-expanded", "true");
	const navigation = page.getByRole("navigation", {
		name: "Navegação principal",
	});
	await expect(navigation).toBeVisible();
	return navigation;
}

async function openAccountMenu(page: Page): Promise<Locator> {
	const trigger = page.getByRole("button", { name: "Abrir menu da conta" });
	await trigger.click();
	await expect(trigger).toHaveAttribute("aria-expanded", "true");
	const panel = page.locator("#global-account-menu");
	await expect(panel).toBeVisible();
	return panel;
}

async function expectHorizontallyContained(
	page: Page,
	locator: Locator,
): Promise<void> {
	expect(
		await page.evaluate(
			() =>
				document.documentElement.scrollWidth <=
				document.documentElement.clientWidth,
		),
	).toBeTruthy();

	const viewport = page.viewportSize();
	const box = await locator.boundingBox();
	expect(viewport).not.toBeNull();
	expect(box).not.toBeNull();
	if (!viewport || !box) return;

	expect(box.x).toBeGreaterThanOrEqual(-1);
	expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
}

async function attachScreenshot(
	page: Page,
	testInfo: TestInfo,
	name: string,
): Promise<void> {
	const path = testInfo.outputPath(`${name}.png`);
	await page.screenshot({ path, fullPage: false });
	await testInfo.attach(name, { path, contentType: "image/png" });
}

test("launcher exposes the complete public IA in stable order and marks subroutes", async ({
	page,
}) => {
	await mockAccess(page);
	await page.goto("/sessoes/nonexistent");
	const navigation = await openLauncher(page);

	const labels = await navigation.locator(".product-launcher-link").allTextContents();
	expect(labels.slice(0, publicDestinations.length)).toEqual(
		publicDestinations.map(([label]) => label),
	);

	for (const [label, href] of publicDestinations) {
		await expect(
			navigation.getByRole("link", { name: label, exact: true }),
		).toHaveAttribute("href", href);
	}

	await expect(
		navigation.getByRole("link", { name: "Sessões", exact: true }),
	).toHaveAttribute("aria-current", "page");
	await expect(navigation.getByText("Ferramentas", { exact: true })).toHaveCount(
		0,
	);
	await expect(navigation.locator('[role="menu"], [role="menuitem"]')).toHaveCount(
		0,
	);
});

test("launcher projects only authorized tools from the server capability response", async ({
	page,
}) => {
	await mockAccess(page, {
		capabilities: [
			"campaign.transcript.read",
			"campaign.local.process",
			"campaign.permissions.manage",
		],
	});
	await page.goto("/");
	const navigation = await openLauncher(page);

	await expect(navigation.getByText("Ferramentas", { exact: true })).toBeVisible();
	await expect(
		navigation.getByRole("link", { name: "Transcrições", exact: true }),
	).toHaveAttribute("href", "/transcricoes");
	await expect(
		navigation.getByRole("link", { name: "Editar sessões", exact: true }),
	).toHaveAttribute("href", "/edit/sessoes");
	await expect(
		navigation.getByRole("link", { name: "Processar", exact: true }),
	).toHaveAttribute("href", "/edit/processamento");
	await expect(
		navigation.getByRole("link", { name: "Permissões", exact: true }),
	).toHaveAttribute("href", "/edit/yuhara-main/permissions");
	await expect(
		navigation.getByRole("link", { name: "Editar mundo", exact: true }),
	).toHaveCount(0);
	await expect(
		navigation.getByRole("link", { name: "Revisão", exact: true }),
	).toHaveCount(0);
});

test("full capability projection exposes every supported tool without changing public order", async ({
	page,
}) => {
	await mockAccess(page, { capabilities: fullCapabilities });
	await page.goto("/");
	const navigation = await openLauncher(page);

	for (const label of [
		"Transcrições",
		"Editar sessões",
		"Processar",
		"Editar mundo",
		"Revisão",
		"Permissões",
	]) {
		await expect(
			navigation.getByRole("link", { name: label, exact: true }),
		).toBeVisible();
	}
	expect(
		(await navigation.locator(".product-launcher-link").allTextContents()).slice(
			0,
			publicDestinations.length,
		),
	).toEqual(publicDestinations.map(([label]) => label));
});

test("auth failure keeps public navigation usable and fail-closed for tools", async ({
	page,
}) => {
	await mockAccess(page, { state: "unavailable" });
	await page.goto("/");
	const navigation = await openLauncher(page);
	await expect(
		navigation.getByRole("link", { name: "Mundo", exact: true }),
	).toBeVisible();
	await expect(navigation.getByText("Ferramentas", { exact: true })).toHaveCount(
		0,
	);

	const account = await openAccountMenu(page);
	await expect(account).toContainText("Conta temporariamente indisponível");
	await expect(
		account.getByRole("button", { name: "Entrar com Discord" }),
	).toHaveCount(0);
	await expect(account.getByRole("button", { name: "Sair" })).toHaveCount(0);
});

test("public destinations render before the private auth projection resolves", async ({
	page,
}) => {
	let releaseAuth = () => {};
	const gate = new Promise<void>((resolve) => {
		releaseAuth = resolve;
	});

	await page.route("**/api/auth/me", async (route) => {
		await gate;
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				state: "authenticated_linked_no_grants",
				scope: { type: "campaign", id: "yuhara-main" },
				identity: syntheticIdentity,
				capabilities: [],
			}),
		});
	});

	await page.goto("/");
	const navigation = await openLauncher(page);
	await expect(
		navigation.getByRole("link", { name: "Mundo", exact: true }),
	).toBeVisible();
	releaseAuth();
});

test("launcher supports click, Enter and Space and Escape restores trigger focus", async ({
	page,
}) => {
	await mockAccess(page);
	await page.goto("/");

	for (const via of ["click", "enter", "space"] as const) {
		await openLauncher(page, via);
		await page.keyboard.press("Escape");
		await expect(
			page.getByRole("navigation", { name: "Navegação principal" }),
		).toHaveCount(0);
		await expect(
			page.getByRole("button", { name: "Abrir navegação" }),
		).toBeFocused();
	}
});

test("closed overlays stay out of the tab order and account panel returns focus independently", async ({
	page,
}) => {
	await mockAccess(page, { state: "anonymous" });
	await page.goto("/");

	const launcher = page.getByRole("button", { name: "Abrir navegação" });
	const account = page.getByRole("button", { name: "Abrir menu da conta" });
	await launcher.focus();
	await page.keyboard.press("Tab");
	await expect(account).toBeFocused();
	await expect(page.locator("#global-product-navigation")).toHaveCount(0);
	await expect(page.locator("#global-account-menu")).toHaveCount(0);

	await page.keyboard.press("Enter");
	await expect(page.locator("#global-account-menu")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.locator("#global-account-menu")).toHaveCount(0);
	await expect(account).toBeFocused();
});

test("outside interaction dismisses the launcher", async ({ page }) => {
	await mockAccess(page);
	await page.goto("/");
	const navigation = await openLauncher(page);
	await expect(navigation).toBeVisible();

	await page.getByRole("heading", { level: 1 }).click();
	await expect(navigation).toHaveCount(0);
});

test("account states keep anonymous, linked, no-grants, avatar and fallback behavior distinct", async ({
	page,
}) => {
	await mockAccess(page, { state: "anonymous" });
	await page.goto("/sessoes?ordem=desc#arquivo");
	let panel = await openAccountMenu(page);
	await expect(
		panel.getByRole("button", { name: "Entrar com Discord" }),
	).toBeVisible();
	await expect(panel.locator('input[name="next"]')).toHaveValue(
		"/sessoes?ordem=desc#arquivo",
	);
	await expect(panel.getByText("Aparência", { exact: true })).toBeVisible();
	await expect(panel.getByRole("button", { name: "Sair" })).toHaveCount(0);

	await page.unroute("**/api/auth/me");
	await mockAccess(page, {
		state: "authenticated_linked_no_grants",
		identity: { displayName: "Ada Navegadora", avatarUrl: null },
	});
	await page.reload();
	await expect(page.locator(".account-avatar-initials")).toHaveText("AN");
	panel = await openAccountMenu(page);
	await expect(panel.getByText("Ada Navegadora", { exact: true })).toBeVisible();
	await expect(panel.getByRole("link", { name: "Conta e acesso" })).toBeVisible();
	const logoutForm = panel.locator('form[action="/auth/logout"]');
	await expect(logoutForm).toHaveAttribute("method", "post");
	await expect(logoutForm.getByRole("button", { name: "Sair" })).toBeVisible();

	await page.unroute("**/api/auth/me");
	await mockAccess(page, {
		state: "authenticated_linked",
		identity: { displayName: "Ada Navegadora", avatarUrl: syntheticAvatar },
	});
	await page.reload();
	await expect(page.locator(".account-avatar-image")).toBeVisible();
});

test("viewport matrix keeps header, launcher and account controls contained with >=44px targets", async ({
	page,
}, testInfo) => {
	test.skip(
		testInfo.project.name !== "desktop-1080p",
		"viewport matrix runs once in the canonical navigation project",
	);
	await mockAccess(page, { capabilities: fullCapabilities });

	for (const viewport of [
		{ width: 320, height: 800 },
		{ width: 390, height: 844 },
		{ width: 768, height: 1024 },
		{ width: 1366, height: 768 },
		{ width: 1920, height: 1080 },
		{ width: 2560, height: 1440 },
	]) {
		await page.setViewportSize(viewport);
		await page.goto("/");
		const navigation = await openLauncher(page);
		await expectHorizontallyContained(page, page.locator(".product-launcher-panel"));

		const launcherBox = await page
			.getByRole("button", { name: "Abrir navegação" })
			.boundingBox();
		const accountBox = await page
			.getByRole("button", { name: "Abrir menu da conta" })
			.boundingBox();
		const firstLinkBox = await navigation
			.getByRole("link", { name: "Sessões", exact: true })
			.boundingBox();

		for (const box of [launcherBox, accountBox, firstLinkBox]) {
			expect(box).not.toBeNull();
			if (!box) continue;
			expect(box.width).toBeGreaterThanOrEqual(44);
			expect(box.height).toBeGreaterThanOrEqual(44);
		}

		await page.keyboard.press("Escape");
		const accountPanel = await openAccountMenu(page);
		await expectHorizontallyContained(page, accountPanel);
		await page.keyboard.press("Escape");
	}
});

test("200% zoom preserves reflow without horizontal overflow", async ({ page }, testInfo) => {
	test.skip(
		testInfo.project.name !== "desktop-1080p",
		"zoom contract runs once in the canonical navigation project",
	);
	await page.setViewportSize({ width: 640, height: 900 });
	await mockAccess(page, { capabilities: fullCapabilities });
	await page.goto("/");
	await page.evaluate(() => {
		document.documentElement.style.setProperty("zoom", "2");
	});

	await openLauncher(page);
	await expectHorizontallyContained(page, page.locator(".product-launcher-panel"));
});

test("reduced motion removes navigation and account transitions", async ({
	page,
}, testInfo) => {
	test.skip(
		testInfo.project.name !== "desktop-1080p",
		"reduced-motion contract runs once in the canonical navigation project",
	);
	await page.emulateMedia({ reducedMotion: "reduce" });
	await mockAccess(page, { state: "anonymous" });
	await page.goto("/");

	const navigation = await openLauncher(page);
	const publicLink = navigation.getByRole("link", {
		name: "Sessões",
		exact: true,
	});
	expect(
		await publicLink.evaluate(
			(element) => getComputedStyle(element).transitionDuration,
		),
	).toBe("0s");

	await page.keyboard.press("Escape");
	const account = await openAccountMenu(page);
	const login = account.getByRole("button", { name: "Entrar com Discord" });
	expect(
		await login.evaluate((element) => getComputedStyle(element).transitionDuration),
	).toBe("0s");
});

test("dark/light desktop/mobile visual receipts use only synthetic navigation fixtures", async ({
	page,
}, testInfo) => {
	test.skip(
		testInfo.project.name !== "desktop-1080p",
		"visual receipts run once in the canonical navigation project",
	);
	await mockAccess(page, {
		capabilities: fullCapabilities,
		identity: syntheticIdentity,
	});

	for (const scenario of [
		{
			name: "navigation-desktop-dark",
			viewport: { width: 1366, height: 768 },
			colorScheme: "dark" as const,
		},
		{
			name: "navigation-desktop-light",
			viewport: { width: 1366, height: 768 },
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
	] as const) {
		await page.setViewportSize(scenario.viewport);
		await page.emulateMedia({ colorScheme: scenario.colorScheme });
		await page.goto("/");
		await openLauncher(page);
		await attachScreenshot(page, testInfo, `${scenario.name}-launcher`);
		await page.keyboard.press("Escape");

		await openAccountMenu(page);
		await attachScreenshot(page, testInfo, `${scenario.name}-account`);
		await page.keyboard.press("Escape");
	}
});
