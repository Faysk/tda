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

async function mockAuthProjection(
	page: import("@playwright/test").Page,
	body: Record<string, unknown>,
	status = 200,
) {
	await page.route("**/api/auth/me", async (route) => {
		await route.fulfill({
			status,
			contentType: "application/json",
			body: JSON.stringify(body),
		});
	});
}

async function mockAccess(
	page: import("@playwright/test").Page,
	capabilities: readonly string[] = [],
	status = 200,
) {
	await mockAuthProjection(
		page,
		{
			state: status === 503 ? "unavailable" : "authenticated_linked",
			scope: { type: "campaign", id: "yuhara-main" },
			...(status === 503 ? {} : { capabilities }),
		},
		status,
	);
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
	const panel = page.locator("#global-account-panel");
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
	await mockAuthProjection(page, {
		state: "anonymous",
		scope: { type: "campaign", id: "yuhara-main" },
	});
	await page.goto("/lore");
	const panel = await openAccountMenu(page);

	await expect(
		panel.getByRole("link", { name: "Entrar com Discord" }),
	).toHaveAttribute("href", "/entrar?next=%2Flore");
	await expect(panel.getByRole("switch", { name: "Modo escuro" })).toBeVisible();
	await expect(page.locator(".header-actions > .theme-toggle")).toHaveCount(0);
});

test("authenticated account uses sanitized identity and keeps logout as POST", async ({
	page,
}) => {
	const avatarUrl = "https://cdn.discordapp.com/avatars/123/hash.png";
	await page.route(avatarUrl, async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "image/png",
			body: Buffer.from(
				"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2U8sAAAAASUVORK5CYII=",
				"base64",
			),
		});
	});
	await mockAuthProjection(page, {
		state: "authenticated_linked",
		scope: { type: "campaign", id: "yuhara-main" },
		capabilities: [],
		identity: { displayName: "Renan", avatarUrl },
	});
	await page.goto("/");

	await expect(
		page.locator(".account-menu-trigger .account-menu-avatar-image"),
	).toBeVisible();
	const panel = await openAccountMenu(page);
	await expect(panel.getByText("Renan", { exact: true })).toBeVisible();
	await expect(
		panel.getByRole("link", { name: "Conta e acesso" }),
	).toHaveAttribute("href", "/conta");
	await expect(
		panel.locator('form[action="/auth/logout"][method="post"]'),
	).toHaveCount(1);
	await expect(panel.getByRole("button", { name: "Sair" })).toBeVisible();
});

test("broken account avatar falls back to safe initials", async ({ page }) => {
	const avatarUrl = "https://cdn.discordapp.com/avatars/123/broken.png";
	await page.route(avatarUrl, async (route) => {
		await route.abort();
	});
	await mockAuthProjection(page, {
		state: "authenticated_linked",
		scope: { type: "campaign", id: "yuhara-main" },
		capabilities: [],
		identity: { displayName: "Renan Silva", avatarUrl },
	});
	await page.goto("/");

	await expect(
		page.locator(".account-menu-trigger .account-menu-avatar-fallback"),
	).toHaveText("RS");
});

test("unavailable auth remains distinct from anonymous login", async ({ page }) => {
	await mockAuthProjection(
		page,
		{
			state: "unavailable",
			scope: { type: "campaign", id: "yuhara-main" },
		},
		503,
	);
	await page.goto("/");
	const panel = await openAccountMenu(page);

	await expect(panel.getByText("Conta indisponível", { exact: true })).toBeVisible();
	await expect(
		panel.getByRole("link", { name: "Ver estado do acesso" }),
	).toHaveAttribute("href", "/conta?acesso=indisponivel");
	await expect(
		panel.getByRole("link", { name: "Entrar com Discord" }),
	).toHaveCount(0);
});

test("Escape closes the account panel and restores trigger focus", async ({
	page,
}) => {
	await mockAuthProjection(page, {
		state: "anonymous",
		scope: { type: "campaign", id: "yuhara-main" },
	});
	await page.goto("/");
	const panel = await openAccountMenu(page);

	await page.keyboard.press("Escape");
	await expect(panel).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "Abrir menu da conta" }),
	).toBeFocused();
});

test("appearance control inside the account panel persists an explicit theme", async ({
	page,
}) => {
	await mockAuthProjection(page, {
		state: "anonymous",
		scope: { type: "campaign", id: "yuhara-main" },
	});
	await page.goto("/");
	const panel = await openAccountMenu(page);
	await panel.getByRole("switch", { name: "Modo escuro" }).click();

	const preference = await page.evaluate(() =>
		window.localStorage.getItem("tda-theme"),
	);
	expect(["light", "dark"]).toContain(preference);
	await expect(page.locator("html")).toHaveAttribute("data-theme", preference ?? "");
});

test("account panel stays horizontally contained at 320px", async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 800 });
	await mockAuthProjection(page, {
		state: "anonymous",
		scope: { type: "campaign", id: "yuhara-main" },
	});
	await page.goto("/");
	await openAccountMenu(page);

	expect(
		await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
	).toBeTruthy();
	const box = await page.locator(".account-menu-panel").boundingBox();
	expect(box).not.toBeNull();
	if (!box) return;
	expect(box.x).toBeGreaterThanOrEqual(0);
	expect(box.x + box.width).toBeLessThanOrEqual(320);
});
