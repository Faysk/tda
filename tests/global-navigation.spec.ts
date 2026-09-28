import { expect, test, type Page, type TestInfo } from "@playwright/test";

type NavigationState =
	| "anonymous"
	| "unavailable"
	| "authenticated_unlinked"
	| "authenticated_linked"
	| "authenticated_linked_no_grants";

type Projection = Readonly<{
	state: NavigationState;
	identity?: Readonly<{
		displayName: string | null;
		avatarUrl: string | null;
	}> | null;
	capabilities?: readonly string[];
}>;

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

async function mockProjection(
	page: Page,
	projection: Projection,
	status = projection.state === "unavailable" ? 503 : 200,
) {
	await page.route("**/api/auth/me", async (route) => {
		await route.fulfill({
			status,
			contentType: "application/json",
			body: JSON.stringify({
				state: projection.state,
				scope: { type: "campaign", id: "yuhara-main" },
				identity: projection.identity ?? null,
				capabilities: projection.capabilities ?? [],
			}),
		});
	});
}

async function openLauncher(page: Page) {
	const trigger = page.getByRole("button", { name: "Abrir navegação" });
	await trigger.click();
	await expect(trigger).toHaveAttribute("aria-expanded", "true");
	const navigation = page.getByRole("navigation", {
		name: "Navegação principal",
	});
	await expect(navigation).toBeVisible();
	return navigation;
}

async function openAccount(page: Page) {
	const trigger = page.getByRole("button", { name: "Abrir menu da conta" });
	await trigger.click();
	await expect(trigger).toHaveAttribute("aria-expanded", "true");
	const panel = page.getByRole("region", { name: "Conta e aparência" });
	await expect(panel).toBeVisible();
	return panel;
}

async function assertContained(page: Page, locator: import("@playwright/test").Locator) {
	expect(
		await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
	).toBeTruthy();
	const box = await locator.boundingBox();
	expect(box).not.toBeNull();
	if (!box) return;
	const viewport = page.viewportSize();
	expect(viewport).not.toBeNull();
	if (!viewport) return;
	expect(box.x).toBeGreaterThanOrEqual(0);
	expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 0.5);
	expect(box.y).toBeGreaterThanOrEqual(0);
	expect(box.y).toBeLessThan(viewport.height);
}

async function setTheme(page: Page, theme: "light" | "dark") {
	await page.addInitScript((value) => {
		window.localStorage.setItem("tda-theme", value);
	}, theme);
}

async function screenshotReceipt(
	page: Page,
	testInfo: TestInfo,
	name: string,
) {
	await page.screenshot({
		path: testInfo.outputPath(name),
		fullPage: true,
		animations: "disabled",
	});
}

test("launcher exposes stable public IA, current subroute and no ARIA application menu", async ({
	page,
}) => {
	await mockProjection(page, {
		state: "authenticated_linked_no_grants",
	});
	await page.goto("/sessoes/nonexistent");
	const navigation = await openLauncher(page);

	const labels = await navigation.locator(".product-launcher-link").allTextContents();
	expect(labels.slice(0, publicLabels.length)).toEqual(publicLabels);
	await expect(
		navigation.getByRole("link", { name: "Sessões", exact: true }),
	).toHaveAttribute("aria-current", "page");
	await expect(navigation.getByText("Ferramentas", { exact: true })).toHaveCount(0);
	await expect(navigation.locator('[role="menu"], [role="menuitem"]')).toHaveCount(0);
});

test("launcher projects partial and broad capability sets without making client state authority", async ({
	page,
}) => {
	await mockProjection(page, {
		state: "authenticated_linked",
		capabilities: [
			"campaign.transcript.read",
			"campaign.local.process",
			"campaign.permissions.manage",
		],
	});
	await page.goto("/");
	let navigation = await openLauncher(page);

	await expect(navigation.getByText("Ferramentas", { exact: true })).toBeVisible();
	for (const label of ["Transcrições", "Editar sessões", "Processar", "Permissões"]) {
		await expect(navigation.getByRole("link", { name: label, exact: true })).toBeVisible();
	}
	for (const label of ["Editar mundo", "Revisão"]) {
		await expect(navigation.getByRole("link", { name: label, exact: true })).toHaveCount(0);
	}

	await page.unroute("**/api/auth/me");
	await mockProjection(page, {
		state: "authenticated_linked",
		capabilities: allToolCapabilities,
	});
	await page.reload();
	navigation = await openLauncher(page);
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

test("anonymous and unavailable auth keep public navigation immediate and tools fail closed", async ({
	page,
}) => {
	for (const projection of [
		{ state: "anonymous" as const },
		{ state: "unavailable" as const },
	]) {
		await page.unroute("**/api/auth/me");
		await mockProjection(page, projection);
		await page.goto("/");
		const navigation = await openLauncher(page);
		await expect(
			navigation.getByRole("link", { name: "Mundo", exact: true }),
		).toBeVisible();
		await expect(navigation.getByText("Ferramentas", { exact: true })).toHaveCount(0);
	}
});

test("launcher opens with Enter and Space, Escape restores focus and outside pointer dismisses", async ({
	page,
}) => {
	await mockProjection(page, { state: "anonymous" });
	await page.goto("/");
	const trigger = page.getByRole("button", { name: "Abrir navegação" });

	await trigger.focus();
	await page.keyboard.press("Enter");
	await expect(page.getByRole("navigation", { name: "Navegação principal" })).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(trigger).toBeFocused();

	await page.keyboard.press("Space");
	await expect(page.getByRole("navigation", { name: "Navegação principal" })).toBeVisible();
	await page.getByRole("heading", { level: 1 }).click();
	await expect(
		page.getByRole("navigation", { name: "Navegação principal" }),
	).toHaveCount(0);
	await expect(trigger).toHaveAttribute("aria-expanded", "false");
});

test("closed launcher content is absent from the tab order", async ({ page }) => {
	await mockProjection(page, {
		state: "authenticated_linked",
		capabilities: allToolCapabilities,
	});
	await page.goto("/");
	const navigation = await openLauncher(page);
	await expect(navigation.getByRole("link", { name: "Sessões" })).toBeVisible();
	await page.keyboard.press("Escape");

	await expect(navigation).toHaveCount(0);
	await page.keyboard.press("Tab");
	await expect(page.getByRole("button", { name: "Abrir menu da conta" })).toBeFocused();
});

test("account panel covers authenticated avatar/fallback, login return path, logout POST and theme", async ({
	page,
}) => {
	await mockProjection(page, {
		state: "authenticated_linked",
		identity: {
			displayName: "Pessoa Sintética",
			avatarUrl: null,
		},
		capabilities: [],
	});
	await page.goto("/");
	let panel = await openAccount(page);
	await expect(panel.getByText("Pessoa Sintética", { exact: true })).toBeVisible();
	await expect(page.locator(".account-avatar-initials")).toHaveText("PS");
	const logout = panel.locator('form[action="/auth/logout"]');
	await expect(logout).toHaveAttribute("method", "post");

	const theme = panel.getByRole("switch", { name: "Modo escuro" });
	const before = await page.locator("html").getAttribute("data-theme");
	await theme.click();
	const after = await page.locator("html").getAttribute("data-theme");
	expect(after).not.toBe(before);

	await page.keyboard.press("Escape");
	await expect(page.getByRole("button", { name: "Abrir menu da conta" })).toBeFocused();

	await page.unroute("**/api/auth/me");
	await mockProjection(page, { state: "anonymous" });
	await page.goto("/?synthetic=1#receipt");
	panel = await openAccount(page);
	const login = panel.locator('form[action="/auth/discord"]');
	await expect(login).toHaveAttribute("method", "post");
	await expect(login.locator('input[name="next"]')).toHaveValue("/?synthetic=1#receipt");
});

test("account and launcher panels open independently and do not leave hidden focus targets", async ({
	page,
}) => {
	await mockProjection(page, {
		state: "authenticated_linked",
		identity: { displayName: "Conta Sintética", avatarUrl: null },
		capabilities: allToolCapabilities,
	});
	await page.goto("/");

	await openLauncher(page);
	await openAccount(page);
	await expect(
		page.getByRole("navigation", { name: "Navegação principal" }),
	).toBeVisible();
	await expect(page.getByRole("region", { name: "Conta e aparência" })).toBeVisible();

	await page.keyboard.press("Escape");
	await expect(page.getByRole("region", { name: "Conta e aparência" })).toHaveCount(0);
	await expect(
		page.getByRole("navigation", { name: "Navegação principal" }),
	).toHaveCount(0);
});

test("six viewport matrix keeps header controls and launcher geometrically contained", async ({
	page,
}) => {
	await mockProjection(page, {
		state: "authenticated_linked",
		identity: { displayName: "QA Sintético", avatarUrl: null },
		capabilities: allToolCapabilities,
	});

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
		await assertContained(page, page.locator(".product-launcher-panel"));

		for (const name of ["Abrir navegação", "Abrir menu da conta"]) {
			const box = await page.getByRole("button", { name }).boundingBox();
			expect(box).not.toBeNull();
			expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
			expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
		}

		await page.keyboard.press("Escape");
		await expect(navigation).toHaveCount(0);
	}
});

test("reduced motion disables launcher/account transitions and 200 percent scale remains operable", async ({
	page,
}) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.setViewportSize({ width: 768, height: 1024 });
	await mockProjection(page, {
		state: "authenticated_linked",
		identity: { displayName: "QA Sintético", avatarUrl: null },
		capabilities: allToolCapabilities,
	});
	await page.goto("/");

	await expect(page.getByRole("button", { name: "Abrir navegação" })).toHaveCSS(
		"transition-duration",
		"0s",
	);
	await expect(page.getByRole("button", { name: "Abrir menu da conta" })).toHaveCSS(
		"transition-duration",
		"0s",
	);

	const session = await page.context().newCDPSession(page);
	await session.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
	const navigation = await openLauncher(page);
	await expect(navigation.getByRole("link", { name: "Sessões" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Abrir menu da conta" })).toBeVisible();
});

test("visual receipts cover desktop/mobile in dark/light with synthetic identity", async ({
	page,
}, testInfo) => {
	await mockProjection(page, {
		state: "authenticated_linked",
		identity: { displayName: "QA Sintético", avatarUrl: null },
		capabilities: allToolCapabilities,
	});

	for (const receipt of [
		{ name: "navigation-desktop-dark.png", width: 1366, height: 768, theme: "dark" as const },
		{ name: "navigation-desktop-light.png", width: 1366, height: 768, theme: "light" as const },
		{ name: "navigation-mobile-dark.png", width: 390, height: 844, theme: "dark" as const },
		{ name: "navigation-mobile-light.png", width: 390, height: 844, theme: "light" as const },
	]) {
		await page.setViewportSize({ width: receipt.width, height: receipt.height });
		await setTheme(page, receipt.theme);
		await page.goto("/");
		await openLauncher(page);
		await screenshotReceipt(page, testInfo, receipt.name);
		await page.keyboard.press("Escape");
	}
});
