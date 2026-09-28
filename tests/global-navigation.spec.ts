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

type MockAuthState =
	| "anonymous"
	| "unavailable"
	| "authenticated_unlinked"
	| "authenticated_linked_no_grants"
	| "authenticated_linked";

type MockIdentity = Readonly<{
	displayName: string | null;
	avatarUrl: string | null;
}>;

async function mockAccess(
	page: import("@playwright/test").Page,
	capabilities: readonly string[] = [],
	status = 200,
	options: Readonly<{
		state?: MockAuthState;
		identity?: MockIdentity | null;
	}> = {},
) {
	const state =
		options.state ?? (status === 503 ? "unavailable" : "authenticated_linked");
	const authenticated = state.startsWith("authenticated_");
	await page.route("**/api/auth/me", async (route) => {
		await route.fulfill({
			status,
			contentType: "application/json",
			body: JSON.stringify({
				state,
				scope: { type: "campaign", id: "yuhara-main" },
				...(authenticated
					? {
							capabilities,
							identity:
								options.identity === undefined
									? { displayName: "Renan Silva", avatarUrl: null }
									: options.identity,
						}
					: {}),
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

async function openAccountMenu(page: import("@playwright/test").Page) {
	const trigger = page.getByRole("button", { name: "Abrir menu da conta" });
	await trigger.click();
	await expect(trigger).toHaveAttribute("aria-expanded", "true");
	const panel = page.locator("#global-account-menu");
	await expect(panel).toBeVisible();
	return panel;
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


test("anonymous account menu preserves the current route and owns appearance", async ({
	page,
}) => {
	await mockAccess(page, [], 200, { state: "anonymous" });
	await page.goto("/mundo");

	await expect(page.locator(".header-actions > .theme-toggle")).toHaveCount(0);
	const panel = await openAccountMenu(page);

	await expect(
		panel.getByRole("link", { name: "Entrar com Discord", exact: true }),
	).toHaveAttribute("href", "/entrar?next=%2Fmundo");
	await expect(panel.getByText("Aparência", { exact: true })).toBeVisible();
	await expect(panel.locator(".theme-toggle")).toHaveCount(1);
	await expect(panel.getByRole("button", { name: "Sair", exact: true })).toHaveCount(0);
});

test("authenticated account menu uses sanitized identity fallback and keeps logout as POST", async ({
	page,
}) => {
	let logoutMethod: string | null = null;
	await mockAccess(page, ["campaign.transcript.read"], 200, {
		state: "authenticated_linked",
		identity: { displayName: "Renan Silva", avatarUrl: null },
	});
	await page.route("**/auth/logout", async (route) => {
		logoutMethod = route.request().method();
		await route.fulfill({ status: 204 });
	});
	await page.goto("/sessoes");

	const trigger = page.getByRole("button", { name: "Abrir menu da conta" });
	await expect(trigger.locator(".account-menu-avatar-fallback")).toHaveText("RS");
	const panel = await openAccountMenu(page);
	await expect(panel.getByText("Renan Silva", { exact: true })).toBeVisible();
	await expect(
		panel.getByRole("link", { name: "Conta e acesso", exact: true }),
	).toHaveAttribute("href", "/conta");

	await panel.getByRole("button", { name: "Sair", exact: true }).click();
	await expect.poll(() => logoutMethod).toBe("POST");
});

test("broken Discord avatar falls back to initials without breaking account state", async ({
	page,
}) => {
	await page.route("https://cdn.discordapp.com/**", async (route) => {
		await route.abort("failed");
	});
	await mockAccess(page, [], 200, {
		state: "authenticated_linked",
		identity: {
			displayName: "Renan Silva",
			avatarUrl: "https://cdn.discordapp.com/avatars/123/hash.png",
		},
	});
	await page.goto("/");

	const trigger = page.getByRole("button", { name: "Abrir menu da conta" });
	await expect(trigger.locator(".account-menu-avatar-fallback")).toHaveText("RS");
});

test("unavailable auth is recoverable and is not presented as logged out", async ({
	page,
}) => {
	await mockAccess(page, [], 503, { state: "unavailable" });
	await page.goto("/");

	const panel = await openAccountMenu(page);
	await expect(
		panel.getByText(
			"Não foi possível verificar sua conta agora. A navegação pública continua disponível.",
			{ exact: true },
		),
	).toBeVisible();
	await expect(
		panel.getByRole("link", { name: "Conta e acesso", exact: true }),
	).toHaveAttribute("href", "/conta?acesso=indisponivel");
	await expect(
		panel.getByRole("link", { name: "Entrar com Discord", exact: true }),
	).toHaveCount(0);
	await expect(panel.getByRole("button", { name: "Sair", exact: true })).toHaveCount(0);
});

test("Escape closes the account panel and returns focus to the avatar trigger", async ({
	page,
}) => {
	await mockAccess(page);
	await page.goto("/");
	const panel = await openAccountMenu(page);

	await page.keyboard.press("Escape");
	await expect(panel).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "Abrir menu da conta" }),
	).toBeFocused();
});

test("account panel stays horizontally contained at 320px", async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 800 });
	await mockAccess(page);
	await page.goto("/");
	const panel = await openAccountMenu(page);

	expect(
		await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
	).toBeTruthy();
	const box = await panel.boundingBox();
	expect(box).not.toBeNull();
	if (!box) return;
	expect(box.x).toBeGreaterThanOrEqual(0);
	expect(box.x + box.width).toBeLessThanOrEqual(320);
});
