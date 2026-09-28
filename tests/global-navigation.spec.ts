import { expect, test } from "@playwright/test";

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

type MockAccessOptions = Readonly<{
	state?: NavigationState;
	capabilities?: readonly string[];
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

	await page.route("**/api/auth/me", async (route) => {
		await route.fulfill({
			status,
			contentType: "application/json",
			body: JSON.stringify({
				state,
				scope: { type: "campaign", id: "yuhara-main" },
				...(authenticated
					? {
							identity:
								options.identity === undefined
									? { displayName: "Navegação Teste", avatarUrl: null }
									: options.identity,
							capabilities: options.capabilities ?? [],
						}
					: {}),
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

test("avatar is the only global trigger and exposes the complete public IA", async ({ page }) => {
	await mockAccess(page);
	await page.goto("/sessoes/nonexistent");
	await expect(page.getByRole("button", { name: "Abrir navegação" })).toHaveCount(0);
	await expect(page.locator(".product-launcher-trigger")).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Abrir menu global" })).toHaveCount(1);
	const panel = await openGlobalMenu(page);
	const navigation = panel.getByRole("navigation", { name: "Navegação principal" });
	const labels = await navigation.locator(".product-launcher-link").allTextContents();
	expect(labels.slice(0, publicLabels.length)).toEqual(publicLabels);
	await expect(navigation.getByRole("link", { name: "Sessões", exact: true })).toHaveAttribute("aria-current", "page");
});

test("unified panel projects only authorized tools", async ({ page }) => {
	await mockAccess(page, { capabilities: ["campaign.transcript.read", "campaign.local.process", "campaign.permissions.manage"] });
	await page.goto("/");
	const panel = await openGlobalMenu(page);
	const navigation = panel.getByRole("navigation", { name: "Navegação principal" });
	await expect(navigation.getByText("Ferramentas", { exact: true })).toBeVisible();
	for (const label of ["Transcrições", "Editar sessões", "Processar", "Permissões"]) {
		await expect(navigation.getByRole("link", { name: label, exact: true })).toBeVisible();
	}
	await expect(navigation.getByRole("link", { name: "Editar mundo", exact: true })).toHaveCount(0);
	await expect(navigation.getByRole("link", { name: "Revisão", exact: true })).toHaveCount(0);
});

test("broad capability projection exposes the complete authorized tool set", async ({ page }) => {
	await mockAccess(page, { capabilities: allToolCapabilities });
	await page.goto("/");
	const panel = await openGlobalMenu(page);
	const navigation = panel.getByRole("navigation", { name: "Navegação principal" });
	for (const label of [
		"Transcrições",
		"Editar sessões",
		"Processar",
		"Editar mundo",
		"Revisão",
		"Permissões",
	]) {
		await expect(navigation.getByRole("link", { name: label, exact: true })).toBeVisible();
	}
});

test("anonymous unified panel keeps public navigation, safe return path and appearance", async ({ page }) => {
	await mockAccess(page, { state: "anonymous" });
	await page.goto("/sessoes");
	const panel = await openGlobalMenu(page);
	await expect(panel.getByRole("button", { name: "Entrar com Discord" })).toBeVisible();
	await expect(panel.locator('input[name="next"]')).toHaveValue("/sessoes");
	await expect(panel.getByRole("switch", { name: "Modo escuro" })).toBeVisible();
	await expect(panel.getByRole("link", { name: "Mundo", exact: true })).toBeVisible();
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
			scope: { type: "campaign", id: "yuhara-main" },
			identity: { displayName: "Pessoa Teste", avatarUrl: null },
			capabilities: allToolCapabilities,
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
	await page.getByRole("heading", { level: 1 }).click();
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
	expect(
		durations
			.split(",")
			.some((value) => Number.parseFloat(value.trim()) >= 1.9),
	).toBeTruthy();

	await trigger.click();
	await expect(trigger).toHaveAttribute("aria-expanded", "false");
	await expect(panel).toHaveAttribute("data-state", "closing");
	await expect(panel).toHaveAttribute("aria-hidden", "true");
	expect(await panel.evaluate((element) => element.hasAttribute("inert"))).toBeTruthy();

	await trigger.click();
	await expect(trigger).toHaveAttribute("aria-expanded", "true");
	await expect(panel).toHaveCount(1);
	await expect(panel).toHaveAttribute("data-state", /opening|open/u);

	await page.getByRole("heading", { level: 1 }).click();
	await expect(trigger).toHaveAttribute("aria-expanded", "false");
	await expect(panel).toHaveAttribute("data-state", "closing");
	await expect(panel).toHaveCount(0, { timeout: 3_000 });
});

test("navigation action does not wait for the 2s opening animation", async ({ page }) => {
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

test("reduced motion bypasses the long panel transition and unmounts immediately", async ({ page }) => {
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

test("unified grid preserves large glyphs while making cells denser", async ({ page }) => {
	await mockAccess(page, { capabilities: allToolCapabilities });
	await page.setViewportSize({ width: 1366, height: 768 });
	await page.goto("/");
	const panel = await openGlobalMenu(page);
	const link = panel.getByRole("link", { name: "Editar sessões", exact: true });
	const icon = link.locator(".product-launcher-item-icon");
	const [linkBox, iconBox] = await Promise.all([link.boundingBox(), icon.boundingBox()]);
	expect(linkBox).not.toBeNull();
	expect(iconBox).not.toBeNull();
	if (linkBox && iconBox) {
		expect(linkBox.height).toBeGreaterThanOrEqual(76);
		expect(linkBox.height).toBeLessThan(96);
		expect(iconBox.width).toBeGreaterThanOrEqual(30);
		expect(iconBox.height).toBeGreaterThanOrEqual(30);
	}
	for (const label of ["Editar sessões", "Transcrições", "Permissões"]) {
		const criticalLink = panel.getByRole("link", { name: label, exact: true });
		await expect(criticalLink).toBeVisible();
		expect(
			await criticalLink.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
		).toBeTruthy();
	}
});

test("unified panel stays contained and scrolls internally across the responsive matrix", async ({ page }) => {
	await mockAccess(page, { capabilities: allToolCapabilities });
	await page.goto("/");
	for (const viewport of [
		{ width: 320, height: 800 },
		{ width: 390, height: 844 },
		{ width: 390, height: 500 },
		{ width: 768, height: 1024 },
		// 1366×768 rendered at 200% browser zoom is approximately this CSS viewport.
		{ width: 683, height: 384 },
		{ width: 1366, height: 768 },
		{ width: 1920, height: 1080 },
		{ width: 2560, height: 1440 },
	]) {
		await page.setViewportSize(viewport);
		const panel = await openGlobalMenu(page);
		await expectNoHorizontalOverflow(page);
		await expectPanelContained(page);
		const columns = await panel.locator(".product-launcher-grid").first().evaluate((element) =>
			getComputedStyle(element).gridTemplateColumns.split(/\s+/u).filter(Boolean).length,
		);
		expect(columns).toBe(viewport.width <= 360 ? 2 : 3);
		if (viewport.height <= 500) {
			const state = await page.locator(".account-menu-panel").evaluate((element) => ({
				clientHeight: element.clientHeight,
				scrollHeight: element.scrollHeight,
				overflowY: getComputedStyle(element).overflowY,
			}));
			expect(state.scrollHeight).toBeGreaterThan(state.clientHeight);
			expect(state.overflowY).toBe("auto");
		}
		await page.keyboard.press("Escape");
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
			body: "Entre com o Discord para consultar seu perfil TDA.",
		},
		{
			query: "unavailable",
			status: "Acesso indisponível",
			body: "Não foi possível consultar seu perfil TDA agora.",
		},
		{
			query: "unlinked",
			status: "Não vinculada",
			body: "Ainda sem perfil TDA vinculado.",
		},
		{
			query: "no-grants",
			status: "Sem permissões nesta campanha",
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
		await expect(page.getByText("profile-tda-synthetic-927", { exact: true })).toBeVisible();
		await expect(
			page.getByRole("heading", { name: "Permissões nesta campanha", exact: true }),
		).toBeVisible();
		await expect(page.getByText("Gerenciar permissões", { exact: true })).toBeVisible();
		await expect(page.getByText("campaign/yuhara-main", { exact: true })).toHaveCount(0);
		await expect(page.getByRole("link", { name: "Ver histórias públicas" })).toHaveCount(0);
		await expect(page.locator('form[action="/auth/logout"]')).toHaveAttribute("method", "post");
		await expectNoHorizontalOverflow(page);
	}

	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/e2e-fixtures/account-overview");
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

