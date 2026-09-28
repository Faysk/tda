import { expect, test, type Locator, type Page } from "@playwright/test";

const publicLabels = [
	"Sessões",
	"Lembra",
	"Lores",
	"Mundo",
	"Personagens",
	"NPCs",
	"Lugares",
	"Facções",
	"Quests",
	"Músicas",
	"Diários",
];

type NavigationState =
	| "anonymous"
	| "unavailable"
	| "authenticated_unlinked"
	| "authenticated_linked"
	| "authenticated_linked_no_grants";

async function mockAuth(
	page: Page,
	input: Readonly<{
		state?: NavigationState;
		displayName?: string | null;
		avatarUrl?: string | null;
		capabilities?: readonly string[];
		status?: number;
	}> = {},
) {
	const state = input.state ?? "authenticated_linked";
	const authenticated = state.startsWith("authenticated_");
	await page.route("**/api/auth/me", async (route) => {
		await route.fulfill({
			status: input.status ?? (state === "unavailable" ? 503 : 200),
			contentType: "application/json",
			body: JSON.stringify({
				state,
				scope: { type: "campaign", id: "yuhara-main" },
				...(authenticated
					? {
							identity: {
								displayName: input.displayName ?? null,
								avatarUrl: input.avatarUrl ?? null,
							},
							capabilities: input.capabilities ?? [],
						}
					: {}),
			}),
		});
	});
}

async function mockAccess(
	page: Page,
	capabilities: readonly string[] = [],
	status = 200,
) {
	await mockAuth(page, {
		state: status === 503 ? "unavailable" : "authenticated_linked",
		capabilities,
		status,
	});
}

async function openLauncher(page: Page) {
	const trigger = page.getByRole("button", { name: "Abrir navegação" });
	await trigger.click();
	await expect(trigger).toHaveAttribute("aria-expanded", "true");
	return page.getByRole("navigation", { name: "Navegação principal" });
}

async function openAccountMenu(page: Page) {
	const trigger = page.getByRole("button", { name: "Abrir menu da conta" });
	await trigger.click();
	await expect(trigger).toHaveAttribute("aria-expanded", "true");
	return page.getByRole("region", { name: "Conta e aparência" });
}

async function expectHorizontallyContained(
	page: Page,
	panel: Locator,
	viewportWidth: number,
) {
	expect(
		await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
	).toBeTruthy();
	const box = await panel.boundingBox();
	expect(box).not.toBeNull();
	if (!box) return;
	expect(box.x).toBeGreaterThanOrEqual(0);
	expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth + 0.5);
}

test("launcher exposes the complete public IA in stable order and marks subroutes", async ({
	page,
}) => {
	await mockAccess(page);
	await page.goto("/sessoes/nonexistent");
	const navigation = await openLauncher(page);
	await expect(navigation).toBeVisible();

	const labels = await navigation.locator(".product-launcher-link").allTextContents();
	expect(labels.slice(0, publicLabels.length)).toEqual(publicLabels);
	await expect(
		navigation.getByRole("link", { name: "Sessões", exact: true }),
	).toHaveAttribute("aria-current", "page");
	await expect(navigation.getByText("Ferramentas", { exact: true })).toHaveCount(0);
});

test("launcher projects only authorized tools from the server capability response", async ({
	page,
}) => {
	await mockAccess(page, [
		"campaign.transcript.read",
		"campaign.local.process",
		"campaign.permissions.manage",
	]);
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

test("launcher exposes every authorized tool and linked-no-grants stays fail-closed", async ({
	page,
}) => {
	await mockAuth(page, {
		state: "authenticated_linked",
		capabilities: [
			"campaign.transcript.read",
			"campaign.local.process",
			"campaign.world.layout.edit",
			"narrative.review.read",
			"campaign.permissions.manage",
		],
	});
	await page.goto("/");
	let navigation = await openLauncher(page);
	await expect(navigation.locator(".product-launcher-tools .product-launcher-link")).toHaveCount(
		6,
	);

	await page.goto("/");
	await page.unroute("**/api/auth/me");
	await mockAuth(page, { state: "authenticated_linked_no_grants" });
	await page.reload();
	navigation = await openLauncher(page);
	await expect(navigation.getByText("Ferramentas", { exact: true })).toHaveCount(0);
});

test("auth failure keeps public navigation usable and fail-closed for tools", async ({
	page,
}) => {
	await mockAccess(page, [], 503);
	await page.goto("/");
	const navigation = await openLauncher(page);
	await expect(
		navigation.getByRole("link", { name: "Mundo", exact: true }),
	).toBeVisible();
	await expect(navigation.getByText("Ferramentas", { exact: true })).toHaveCount(0);
});

test("Escape closes the launcher and returns focus to its trigger", async ({ page }) => {
	await mockAccess(page);
	await page.goto("/");
	const navigation = await openLauncher(page);
	await expect(navigation).toBeVisible();

	await page.keyboard.press("Escape");
	await expect(navigation).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Abrir navegação" })).toBeFocused();
});

test("outside interaction dismisses the launcher", async ({ page }) => {
	await mockAccess(page);
	await page.goto("/");
	const navigation = await openLauncher(page);
	await expect(navigation).toBeVisible();

	await page.getByRole("heading", { level: 1 }).click();
	await expect(navigation).toHaveCount(0);
});

test("anonymous account menu keeps login explicit, POST-only and preserves the return path", async ({
	page,
}) => {
	await mockAuth(page, { state: "anonymous" });
	await page.goto("/mundo?vista=lista");
	const panel = await openAccountMenu(page);

	const form = panel.locator('form[action="/auth/discord"]');
	await expect(form).toHaveAttribute("method", "post");
	await expect(form.locator('input[name="next"]')).toHaveValue("/mundo?vista=lista");
	await expect(
		panel.getByRole("button", { name: "Entrar com Discord", exact: true }),
	).toBeVisible();
	await expect(panel.getByText("Aparência", { exact: true })).toBeVisible();
	await expect(panel.getByRole("button", { name: "Sair", exact: true })).toHaveCount(0);
});

test("authenticated account menu renders an avatar, account link and POST logout", async ({
	page,
}) => {
	await mockAuth(page, {
		state: "authenticated_linked",
		displayName: "Pessoa Sintética",
		avatarUrl: "/brand/favicon.svg",
	});
	await page.goto("/sessoes");

	const trigger = page.getByRole("button", { name: "Abrir menu da conta" });
	await expect(trigger.locator(".account-avatar-image")).toBeVisible();
	const panel = await openAccountMenu(page);
	await expect(panel.getByText("Pessoa Sintética", { exact: true })).toBeVisible();
	await expect(
		panel.getByRole("link", { name: "Conta e acesso", exact: true }),
	).toHaveAttribute("href", "/conta");
	const logout = panel.locator('form[action="/auth/logout"]');
	await expect(logout).toHaveAttribute("method", "post");
	await expect(panel.getByRole("button", { name: "Sair", exact: true })).toBeVisible();
});

test("authenticated account without avatar uses safe initials", async ({ page }) => {
	await mockAuth(page, {
		state: "authenticated_linked",
		displayName: "Pessoa Sintética",
		avatarUrl: null,
	});
	await page.goto("/");

	const trigger = page.getByRole("button", { name: "Abrir menu da conta" });
	await expect(trigger.locator(".account-avatar-initials")).toHaveText("PS");
	const panel = await openAccountMenu(page);
	await expect(panel.getByText("Pessoa Sintética", { exact: true })).toBeVisible();
});

test("unavailable auth is not presented as logged out", async ({ page }) => {
	await mockAuth(page, { state: "unavailable", status: 503 });
	await page.goto("/");
	const panel = await openAccountMenu(page);

	await expect(
		panel.getByText("Conta temporariamente indisponível", { exact: true }),
	).toBeVisible();
	await expect(
		panel.getByRole("button", { name: "Entrar com Discord", exact: true }),
	).toHaveCount(0);
	await expect(panel.getByRole("button", { name: "Tentar novamente" })).toBeVisible();
	await expect(panel.getByText("Aparência", { exact: true })).toBeVisible();
});

test("account Escape closes the panel and returns focus to the avatar trigger", async ({
	page,
}) => {
	await mockAuth(page, { state: "anonymous" });
	await page.goto("/");
	const panel = await openAccountMenu(page);
	await expect(panel).toBeVisible();

	await page.keyboard.press("Escape");
	await expect(panel).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "Abrir menu da conta" }),
	).toBeFocused();
});

test("launcher and account disclosures are independent and dismiss each other", async ({
	page,
}) => {
	await mockAuth(page, { state: "anonymous" });
	await page.goto("/");

	const navigation = await openLauncher(page);
	await expect(navigation).toBeVisible();
	const account = await openAccountMenu(page);
	await expect(navigation).toHaveCount(0);
	await expect(account).toBeVisible();

	const reopenedNavigation = await openLauncher(page);
	await expect(account).toHaveCount(0);
	await expect(reopenedNavigation).toBeVisible();
});

test("native keyboard disclosure semantics work without application menu roles", async ({
	page,
}) => {
	await mockAuth(page, { state: "anonymous" });
	await page.goto("/");

	const launcher = page.getByRole("button", { name: "Abrir navegação" });
	await launcher.focus();
	await page.keyboard.press("Enter");
	await expect(launcher).toHaveAttribute("aria-expanded", "true");
	await expect(page.getByRole("menu")).toHaveCount(0);

	await page.keyboard.press("Tab");
	await expect(
		page
			.getByRole("navigation", { name: "Navegação principal" })
			.getByRole("link", { name: "Sessões", exact: true }),
	).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(launcher).toBeFocused();

	const account = page.getByRole("button", { name: "Abrir menu da conta" });
	await account.focus();
	await page.keyboard.press("Space");
	await expect(account).toHaveAttribute("aria-expanded", "true");
	await expect(page.getByRole("menu")).toHaveCount(0);
});

test("closed disclosures remove hidden navigation controls from the tab order", async ({
	page,
}) => {
	await mockAuth(page, { state: "anonymous" });
	await page.goto("/");

	await expect(page.locator(".product-launcher-panel")).toHaveCount(0);
	await expect(page.locator(".account-menu-panel")).toHaveCount(0);
	await expect(
		page.getByRole("link", { name: "Sessões", exact: true }),
	).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "Entrar com Discord", exact: true }),
	).toHaveCount(0);
});

test("launcher and account triggers preserve 44px touch targets", async ({ page }) => {
	await mockAuth(page, { state: "anonymous" });
	await page.goto("/");

	for (const trigger of [
		page.getByRole("button", { name: "Abrir navegação" }),
		page.getByRole("button", { name: "Abrir menu da conta" }),
	]) {
		const box = await trigger.boundingBox();
		expect(box).not.toBeNull();
		if (!box) continue;
		expect(box.width).toBeGreaterThanOrEqual(44);
		expect(box.height).toBeGreaterThanOrEqual(44);
	}
});

test("responsive navigation matrix stays contained from 320px through 2K", async ({
	page,
}) => {
	const viewports = [
		{ width: 320, height: 800 },
		{ width: 390, height: 844 },
		{ width: 768, height: 1024 },
		{ width: 1366, height: 768 },
		{ width: 1920, height: 1080 },
		{ width: 2560, height: 1440 },
	] as const;
	await mockAuth(page, {
		state: "authenticated_linked",
		displayName: "Pessoa Sintética",
		capabilities: ["campaign.transcript.read", "campaign.local.process"],
	});

	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		await page.goto("/");
		const navigation = await openLauncher(page);
		await expectHorizontallyContained(
			page,
			page.locator(".product-launcher-panel"),
			viewport.width,
		);
		await page.keyboard.press("Escape");
		await expect(navigation).toHaveCount(0);

		const account = await openAccountMenu(page);
		await expectHorizontallyContained(
			page,
			page.locator(".account-menu-panel"),
			viewport.width,
		);
		await page.keyboard.press("Escape");
		await expect(account).toHaveCount(0);
	}
});

test("200 percent desktop zoom equivalent remains usable at the reduced CSS viewport", async ({
	page,
}) => {
	// Browser zoom reduces the CSS-pixel viewport. 1366x768 at 200% is represented
	// here by its half-size layout viewport, which exercises the same responsive rules.
	const viewport = { width: 683, height: 384 };
	await page.setViewportSize(viewport);
	await mockAuth(page, {
		state: "authenticated_linked",
		capabilities: ["campaign.transcript.read", "campaign.local.process"],
	});
	await page.goto("/");

	await openLauncher(page);
	await expectHorizontallyContained(
		page,
		page.locator(".product-launcher-panel"),
		viewport.width,
	);
	await page.keyboard.press("Escape");
	await openAccountMenu(page);
	await expectHorizontallyContained(
		page,
		page.locator(".account-menu-panel"),
		viewport.width,
	);
});

test("reduced motion removes launcher and account disclosure transitions", async ({
	page,
}) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await mockAuth(page, { state: "anonymous" });
	await page.goto("/");

	const navigation = await openLauncher(page);
	const navLink = navigation.getByRole("link", { name: "Sessões", exact: true });
	expect(
		await navLink.evaluate((element) => getComputedStyle(element).transitionDuration),
	).toBe("0s");
	await page.keyboard.press("Escape");

	const account = await openAccountMenu(page);
	const login = account.getByRole("button", { name: "Entrar com Discord", exact: true });
	expect(
		await login.evaluate((element) => getComputedStyle(element).transitionDuration),
	).toBe("0s");
});

test("records sanitized desktop and mobile dark/light navigation receipts", async ({
	page,
}, testInfo) => {
	await mockAuth(page, { state: "anonymous" });
	const receipts = [
		{ name: "desktop-dark", width: 1920, height: 1080, scheme: "dark" },
		{ name: "desktop-light", width: 1920, height: 1080, scheme: "light" },
		{ name: "mobile-dark", width: 390, height: 844, scheme: "dark" },
		{ name: "mobile-light", width: 390, height: 844, scheme: "light" },
	] as const;

	for (const receipt of receipts) {
		await page.setViewportSize({ width: receipt.width, height: receipt.height });
		await page.emulateMedia({ colorScheme: receipt.scheme });
		await page.goto("/");
		await openLauncher(page);
		await page.screenshot({
			path: testInfo.outputPath("navigation-" + receipt.name + "-launcher.png"),
			fullPage: false,
		});
		await page.keyboard.press("Escape");
		await openAccountMenu(page);
		await page.screenshot({
			path: testInfo.outputPath("navigation-" + receipt.name + "-account.png"),
			fullPage: false,
		});
		await page.keyboard.press("Escape");
	}
});
