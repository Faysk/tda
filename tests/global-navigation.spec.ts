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

async function mockAccess(
	page: import("@playwright/test").Page,
	capabilities: readonly string[] = [],
	status = 200,
) {
	await page.route("**/api/auth/me", async (route) => {
		await route.fulfill({
			status,
			contentType: "application/json",
			body: JSON.stringify({
				state: status === 503 ? "unavailable" : "authenticated_linked",
				scope: { type: "campaign", id: "yuhara-main" },
				capabilities,
			}),
		});
	});
}

async function openLauncher(page: import("@playwright/test").Page) {
	const trigger = page.getByRole("button", { name: "Abrir navegação" });
	await trigger.click();
	await expect(trigger).toHaveAttribute("aria-expanded", "true");
	return page.getByRole("navigation", { name: "Navegação principal" });
}

async function mockAccountProjection(
	page: import("@playwright/test").Page,
	input: Readonly<{
		state?:
			| "anonymous"
			| "unavailable"
			| "authenticated_unlinked"
			| "authenticated_linked"
			| "authenticated_linked_no_grants";
		displayName?: string | null;
		avatarUrl?: string | null;
		capabilities?: readonly string[];
		status?: number;
	}> = {},
) {
	const state = input.state ?? "authenticated_linked";
	await page.route("**/api/auth/me", async (route) => {
		await route.fulfill({
			status: input.status ?? (state === "unavailable" ? 503 : 200),
			contentType: "application/json",
			body: JSON.stringify({
				state,
				scope: { type: "campaign", id: "yuhara-main" },
				...(state.startsWith("authenticated_")
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

async function openAccountMenu(page: import("@playwright/test").Page) {
	const trigger = page.getByRole("button", { name: "Abrir menu da conta" });
	await trigger.click();
	await expect(trigger).toHaveAttribute("aria-expanded", "true");
	return page.locator("#global-account-panel");
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

test("launcher stays horizontally contained at 320px", async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 800 });
	await mockAccess(page, ["campaign.transcript.read", "campaign.local.process"]);
	await page.goto("/");
	const navigation = await openLauncher(page);
	await expect(navigation).toBeVisible();

	expect(
		await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
	).toBeTruthy();
	const panel = page.locator(".product-launcher-panel");
	const box = await panel.boundingBox();
	expect(box).not.toBeNull();
	if (!box) return;
	expect(box.x).toBeGreaterThanOrEqual(0);
	expect(box.x + box.width).toBeLessThanOrEqual(320);
});


test("anonymous account menu keeps login explicit and preserves the current return path", async ({
	page,
}) => {
	await mockAccountProjection(page, { state: "anonymous" });
	await page.goto("/mundo?vista=lista");
	const panel = await openAccountMenu(page);

	await expect(panel.getByText("Visitante", { exact: true })).toBeVisible();
	const form = panel.locator('form[action="/auth/discord"]');
	await expect(form).toHaveAttribute("method", "post");
	await expect(form.locator('input[name="next"]')).toHaveValue("/mundo?vista=lista");
	await expect(
		panel.getByRole("button", { name: "Entrar com Discord" }),
	).toBeVisible();
	await expect(panel.getByText("Aparência", { exact: true })).toBeVisible();
	await expect(page.locator(".site-header > .theme-toggle")).toHaveCount(0);
});

test("authenticated account menu renders sanitized identity, account link and POST logout", async ({
	page,
}) => {
	const avatar = "https://cdn.discordapp.com/avatars/123/abc.png";
	await page.route(avatar, async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "image/svg+xml",
			body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"></svg>',
		});
	});
	await mockAccountProjection(page, {
		state: "authenticated_linked",
		displayName: "Renan Silva",
		avatarUrl: avatar,
	});
	await page.goto("/sessoes");

	await expect(
		page.locator('.account-menu-trigger img[src="' + avatar + '"]'),
	).toBeVisible();
	const panel = await openAccountMenu(page);
	await expect(panel.getByText("Renan Silva", { exact: true })).toBeVisible();
	await expect(
		panel.getByRole("link", { name: "Conta e acesso", exact: true }),
	).toHaveAttribute("href", "/conta");
	const logout = panel.locator('form[action="/auth/logout"]');
	await expect(logout).toHaveAttribute("method", "post");
	await expect(panel.getByRole("button", { name: "Sair", exact: true })).toBeVisible();
	await expect(
		panel.getByRole("button", { name: "Entrar com Discord" }),
	).toHaveCount(0);
});

test("broken Discord avatar falls back to safe initials without breaking auth state", async ({
	page,
}) => {
	const avatar = "https://cdn.discordapp.com/avatars/123/missing.png";
	await page.route(avatar, async (route) => {
		await route.fulfill({ status: 404, body: "" });
	});
	await mockAccountProjection(page, {
		state: "authenticated_linked",
		displayName: "Renan Silva",
		avatarUrl: avatar,
	});
	await page.goto("/");

	await expect(page.locator(".account-avatar-initials")).toHaveText("RS");
	const panel = await openAccountMenu(page);
	await expect(panel.getByText("Renan Silva", { exact: true })).toBeVisible();
});

test("unavailable auth is distinct from logout and keeps appearance available", async ({
	page,
}) => {
	await mockAccountProjection(page, {
		state: "unavailable",
		status: 503,
	});
	await page.goto("/");
	const panel = await openAccountMenu(page);

	await expect(
		panel.getByText("Verificação indisponível", { exact: true }),
	).toBeVisible();
	await expect(
		panel.getByRole("button", { name: "Entrar com Discord" }),
	).toHaveCount(0);
	await expect(
		panel.getByRole("link", { name: "Conta e acesso", exact: true }),
	).toHaveAttribute("href", "/conta?acesso=indisponivel");
	await expect(panel.getByText("Aparência", { exact: true })).toBeVisible();
});

test("account Escape closes the panel and returns focus to the avatar trigger", async ({
	page,
}) => {
	await mockAccountProjection(page, { state: "anonymous" });
	await page.goto("/");
	const panel = await openAccountMenu(page);
	await expect(panel).toBeVisible();

	await page.keyboard.press("Escape");
	await expect(panel).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "Abrir menu da conta" }),
	).toBeFocused();
});

test("appearance control lives inside the account panel and persists an explicit theme", async ({
	page,
}) => {
	await mockAccountProjection(page, { state: "anonymous" });
	await page.goto("/");
	const panel = await openAccountMenu(page);

	const theme = panel.getByRole("switch", { name: "Modo escuro" });
	await expect(theme).toBeVisible();
	await theme.click();
	expect(
		await page.evaluate(() => window.localStorage.getItem("tda-theme")),
	).toMatch(/^(light|dark)$/u);
});

test("account panel stays horizontally contained at 320px", async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 800 });
	await mockAccountProjection(page, {
		state: "authenticated_linked",
		displayName: "Pessoa com um nome razoavelmente longo",
	});
	await page.goto("/");
	const panel = await openAccountMenu(page);
	await expect(panel).toBeVisible();

	expect(
		await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
	).toBeTruthy();
	const box = await panel.boundingBox();
	expect(box).not.toBeNull();
	if (!box) return;
	expect(box.x).toBeGreaterThanOrEqual(0);
	expect(box.x + box.width).toBeLessThanOrEqual(320);
});
