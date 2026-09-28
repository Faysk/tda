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

async function openLauncher(page: import("@playwright/test").Page) {
	const trigger = page.getByRole("button", { name: "Abrir navegação" });
	await trigger.click();
	await expect(trigger).toHaveAttribute("aria-expanded", "true");
	return page.getByRole("navigation", { name: "Navegação principal" });
}

async function openAccount(page: import("@playwright/test").Page) {
	const trigger = page.getByRole("button", { name: "Abrir menu da conta" });
	await trigger.click();
	await expect(trigger).toHaveAttribute("aria-expanded", "true");
	return page.getByRole("region", { name: "Conta e aparência" });
}

async function expectNoHorizontalOverflow(
	page: import("@playwright/test").Page,
) {
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth + 1,
		),
	).toBeTruthy();
}

async function expectPanelContained(
	page: import("@playwright/test").Page,
	selector: string,
) {
	const viewport = page.viewportSize();
	expect(viewport).not.toBeNull();
	if (!viewport) return;
	const box = await page.locator(selector).boundingBox();
	expect(box).not.toBeNull();
	if (!box) return;
	expect(box.x).toBeGreaterThanOrEqual(-1);
	expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
	expect(box.y).toBeGreaterThanOrEqual(-1);
	expect(box.y).toBeLessThan(viewport.height);
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

test("broad capability projection exposes every governed tool without affecting public IA", async ({
	page,
}) => {
	await mockAccess(page, { capabilities: allToolCapabilities });
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
	for (const label of publicLabels) {
		await expect(
			navigation.getByRole("link", { name: label, exact: true }),
		).toBeVisible();
	}
});

test("anonymous account menu keeps a safe return path and appearance control", async ({
	page,
}) => {
	await mockAccess(page, { state: "anonymous" });
	await page.goto("/sessoes");
	const account = await openAccount(page);

	await expect(
		account.getByRole("button", { name: "Entrar com Discord" }),
	).toBeVisible();
	await expect(account.locator('input[name="next"]')).toHaveValue("/sessoes");
	await expect(account.getByRole("switch", { name: "Modo escuro" })).toBeVisible();
	await expect(account.getByRole("link", { name: "Conta e acesso" })).toHaveCount(0);
});

test("authenticated account menu uses identity fallback, POST logout and no-grant fail closed state", async ({
	page,
}) => {
	await mockAccess(page, {
		state: "authenticated_linked_no_grants",
		identity: { displayName: "Pessoa Teste", avatarUrl: null },
	});
	await page.goto("/");

	await expect(page.locator(".account-avatar-initials")).toHaveText("PT");
	const account = await openAccount(page);
	await expect(account.getByText("Pessoa Teste", { exact: true })).toBeVisible();
	await expect(account.getByRole("link", { name: "Conta e acesso" })).toHaveAttribute(
		"href",
		"/conta",
	);
	const logout = account.locator('form[action="/auth/logout"]');
	await expect(logout).toHaveAttribute("method", "post");

	await page.getByRole("button", { name: "Abrir navegação" }).click();
	await expect(
		page.getByRole("navigation", { name: "Navegação principal" }).getByText(
			"Ferramentas",
			{ exact: true },
		),
	).toHaveCount(0);
});

test("authenticated avatar is rendered from the sanitized projection", async ({
	page,
}) => {
	await mockAccess(page, {
		identity: {
			displayName: "Navegação Teste",
			avatarUrl: "/brand/favicon.svg",
		},
	});
	await page.goto("/");
	await expect(page.locator(".account-avatar-image")).toHaveCount(1);
});

test("public navigation renders before the private auth projection settles", async ({ page }) => {
	let releaseAuth: (() => void) | undefined;
	const authReleased = new Promise<void>((resolve) => {
		releaseAuth = resolve;
	});
	await page.route("**/api/auth/me", async (route) => {
		await authReleased;
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				state: "authenticated_linked",
				scope: { type: "campaign", id: "yuhara-main" },
				identity: { displayName: "Pessoa Teste", avatarUrl: null },
				capabilities: allToolCapabilities,
			}),
		});
	});

	await page.goto("/");
	const navigation = await openLauncher(page);
	await expect(
		navigation.getByRole("link", { name: "Sessões", exact: true }),
	).toBeVisible();
	await expect(navigation.getByText("Ferramentas", { exact: true })).toHaveCount(0);

	releaseAuth?.();
	await expect(navigation.getByText("Ferramentas", { exact: true })).toBeVisible();
});

test("auth failure keeps public navigation usable and exposes an actionable account state", async ({
	page,
}) => {
	await mockAccess(page, { state: "unavailable" });
	await page.goto("/");
	const navigation = await openLauncher(page);
	await expect(
		navigation.getByRole("link", { name: "Mundo", exact: true }),
	).toBeVisible();
	await expect(navigation.getByText("Ferramentas", { exact: true })).toHaveCount(0);

	await page.getByRole("button", { name: "Abrir menu da conta" }).click();
	await expect(
		page.getByText("Conta temporariamente indisponível", { exact: true }),
	).toBeVisible();
	await expect(page.getByRole("button", { name: "Tentar novamente" })).toBeVisible();
});

test("keyboard opens launcher with Enter and Space, Escape restores focus", async ({
	page,
}) => {
	await mockAccess(page);
	await page.goto("/");
	const trigger = page.getByRole("button", { name: "Abrir navegação" });

	await trigger.focus();
	await page.keyboard.press("Enter");
	await expect(
		page.getByRole("navigation", { name: "Navegação principal" }),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(
		page.getByRole("navigation", { name: "Navegação principal" }),
	).toHaveCount(0);
	await expect(trigger).toBeFocused();

	await page.keyboard.press("Space");
	await expect(
		page.getByRole("navigation", { name: "Navegação principal" }),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(trigger).toBeFocused();
});

test("account panel and launcher dismiss independently without leaving hidden controls focusable", async ({
	page,
}) => {
	await mockAccess(page, {
		identity: { displayName: "Navegação Teste", avatarUrl: null },
	});
	await page.goto("/");

	const navigation = await openLauncher(page);
	await expect(navigation).toBeVisible();

	const accountTrigger = page.getByRole("button", { name: "Abrir menu da conta" });
	await accountTrigger.click();
	await expect(navigation).toHaveCount(0);
	const account = page.getByRole("region", { name: "Conta e aparência" });
	await expect(account).toBeVisible();

	await page.keyboard.press("Escape");
	await expect(account).toHaveCount(0);
	await expect(accountTrigger).toBeFocused();
	await accountTrigger.press("Tab");
	await expect(page.getByLabel("TDA — Tem Dado Aqui — início")).not.toBeFocused();
});

test("outside interaction dismisses the launcher", async ({ page }) => {
	await mockAccess(page);
	await page.goto("/");
	const navigation = await openLauncher(page);
	await expect(navigation).toBeVisible();

	await page.getByRole("heading", { level: 1 }).click();
	await expect(navigation).toHaveCount(0);
});

test("navigation semantics keep ordinary links, visible focus and 44px touch targets", async ({
	page,
}) => {
	await mockAccess(page, { capabilities: allToolCapabilities });
	await page.goto("/");

	const launcherTrigger = page.getByRole("button", { name: "Abrir navegação" });
	const accountTrigger = page.getByRole("button", { name: "Abrir menu da conta" });
	for (const trigger of [launcherTrigger, accountTrigger]) {
		const box = await trigger.boundingBox();
		expect(box).not.toBeNull();
		if (!box) continue;
		expect(box.width).toBeGreaterThanOrEqual(44);
		expect(box.height).toBeGreaterThanOrEqual(44);
	}

	await launcherTrigger.focus();
	const focusOutline = await launcherTrigger.evaluate((element) => {
		const style = getComputedStyle(element);
		return {
			style: style.outlineStyle,
			width: Number.parseFloat(style.outlineWidth),
		};
	});
	expect(focusOutline.style).not.toBe("none");
	expect(focusOutline.width).toBeGreaterThanOrEqual(2);

	const navigation = await openLauncher(page);
	await expect(navigation.locator('[role="menu"], [role="menuitem"]')).toHaveCount(0);
});

test("launcher uses icon-first cells with larger glyphs and readable labels", async ({
	page,
}) => {
	await mockAccess(page, { capabilities: allToolCapabilities });
	await page.setViewportSize({ width: 1366, height: 768 });
	await page.goto("/");
	const navigation = await openLauncher(page);
	const link = navigation.getByRole("link", { name: "Editar sessões", exact: true });
	const icon = link.locator(".product-launcher-item-icon");
	const label = link.locator("span");

	const [linkBox, iconBox, labelBox] = await Promise.all([
		link.boundingBox(),
		icon.boundingBox(),
		label.boundingBox(),
	]);
	expect(linkBox).not.toBeNull();
	expect(iconBox).not.toBeNull();
	expect(labelBox).not.toBeNull();
	if (!linkBox || !iconBox || !labelBox) return;

	expect(linkBox.height).toBeGreaterThanOrEqual(88);
	expect(iconBox.width).toBeGreaterThanOrEqual(30);
	expect(iconBox.height).toBeGreaterThanOrEqual(30);
	expect(iconBox.y + iconBox.height).toBeLessThanOrEqual(labelBox.y + 2);
	expect(Math.abs(iconBox.x + iconBox.width / 2 - (linkBox.x + linkBox.width / 2))).toBeLessThanOrEqual(2);
	expect(Math.abs(labelBox.x + labelBox.width / 2 - (linkBox.x + linkBox.width / 2))).toBeLessThanOrEqual(2);

	const labelStyle = await label.evaluate((element) => {
		const style = getComputedStyle(element);
		return {
			whiteSpace: style.whiteSpace,
			textAlign: style.textAlign,
		};
	});
	expect(labelStyle.whiteSpace).not.toBe("nowrap");
	expect(labelStyle.textAlign).toBe("center");
});

test("390px launcher keeps long tool labels inside their cells", async ({
	page,
}) => {
	await mockAccess(page, { capabilities: allToolCapabilities });
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/");
	const navigation = await openLauncher(page);
	const columnCount = await navigation
		.locator(".product-launcher-grid")
		.first()
		.evaluate((element) =>
			getComputedStyle(element).gridTemplateColumns.split(/\s+/u).filter(Boolean).length,
		);
	expect(columnCount).toBe(3);

	for (const labelText of ["Transcrições", "Editar sessões", "Permissões"]) {
		const link = navigation.getByRole("link", { name: labelText, exact: true });
		await expect(link).toBeVisible();
		const label = link.locator("span");
		expect(
			await label.evaluate(
				(element) =>
					element.scrollWidth <= element.clientWidth + 1 &&
					element.scrollHeight <= element.clientHeight + 1,
			),
		).toBeTruthy();
	}
});

test("short mobile viewport keeps launcher scrolling inside the panel", async ({
	page,
}) => {
	await mockAccess(page, { capabilities: allToolCapabilities });
	await page.setViewportSize({ width: 390, height: 500 });
	await page.goto("/");

	const trigger = page.getByRole("button", { name: "Abrir navegação" });
	const triggerBefore = await trigger.boundingBox();
	await openLauncher(page);
	const panel = page.locator(".product-launcher-panel");
	const scrollState = await panel.evaluate((element) => ({
		clientHeight: element.clientHeight,
		scrollHeight: element.scrollHeight,
		overflowY: getComputedStyle(element).overflowY,
	}));

	expect(scrollState.scrollHeight).toBeGreaterThan(scrollState.clientHeight);
	expect(scrollState.overflowY).toBe("auto");
	await panel.evaluate((element) => {
		element.scrollTop = element.scrollHeight;
	});
	expect(await page.evaluate(() => window.scrollY)).toBe(0);

	const triggerAfter = await trigger.boundingBox();
	expect(triggerBefore).not.toBeNull();
	expect(triggerAfter).not.toBeNull();
	if (triggerBefore && triggerAfter) {
		expect(Math.abs(triggerBefore.y - triggerAfter.y)).toBeLessThanOrEqual(1);
	}
});

test("navigation stays contained across the required responsive matrix", async ({
	page,
}) => {
	await mockAccess(page, { capabilities: allToolCapabilities });
	await page.goto("/");

	for (const viewport of [
		{ width: 320, height: 800 },
		{ width: 390, height: 844 },
		{ width: 768, height: 1024 },
		{ width: 1366, height: 768 },
		{ width: 1920, height: 1080 },
		{ width: 2560, height: 1440 },
	]) {
		await page.setViewportSize(viewport);
		const brandBox = await page.getByLabel("TDA — Tem Dado Aqui — início").boundingBox();
		const actionsBox = await page.locator(".header-actions").boundingBox();
		expect(brandBox).not.toBeNull();
		expect(actionsBox).not.toBeNull();
		if (brandBox && actionsBox) {
			expect(brandBox.x + brandBox.width).toBeLessThanOrEqual(actionsBox.x + 1);
		}

		const navigation = await openLauncher(page);
		await expect(navigation).toBeVisible();
		await expectNoHorizontalOverflow(page);
		await expectPanelContained(page, ".product-launcher-panel");
		const columnCount = await navigation
			.locator(".product-launcher-grid")
			.first()
			.evaluate((element) =>
				getComputedStyle(element).gridTemplateColumns.split(/\s+/u).filter(Boolean).length,
			);
		expect(columnCount).toBe(viewport.width <= 360 ? 2 : 3);
		if (viewport.width >= 768) {
			const panelBox = await page.locator(".product-launcher-panel").boundingBox();
			expect(panelBox).not.toBeNull();
			if (panelBox) expect(panelBox.width).toBeLessThanOrEqual(502);
		}
		await page.keyboard.press("Escape");

		const account = await openAccount(page);
		await expect(account).toBeVisible();
		await expectNoHorizontalOverflow(page);
		await expectPanelContained(page, ".account-menu-panel");
		await page.keyboard.press("Escape");
	}
});

test("200 percent desktop zoom equivalent keeps launcher and account panels contained", async ({
	page,
}) => {
	// Browser zoom reduces the CSS-pixel layout viewport. A 1366×768 desktop at
	// 200% therefore exercises the responsive shell around 683×384 CSS px.
	const viewport = { width: 683, height: 384 };
	await mockAccess(page, { capabilities: allToolCapabilities });
	await page.setViewportSize(viewport);
	await page.goto("/");

	const navigation = await openLauncher(page);
	await expect(navigation).toBeVisible();
	await expectNoHorizontalOverflow(page);
	await expectPanelContained(page, ".product-launcher-panel");
	await page.keyboard.press("Escape");

	const account = await openAccount(page);
	await expect(account).toBeVisible();
	await expectNoHorizontalOverflow(page);
	await expectPanelContained(page, ".account-menu-panel");
});

test("reduced motion removes navigation transitions", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await mockAccess(page);
	await page.goto("/");
	const durations = await page
		.locator(".product-launcher-trigger")
		.evaluate((element) => getComputedStyle(element).transitionDuration);
	expect(
		durations
			.split(",")
			.every((value) => Number.parseFloat(value.trim()) === 0),
	).toBeTruthy();
});

test("appearance control toggles the explicit document theme", async ({ page }) => {
	await page.emulateMedia({ colorScheme: "dark" });
	await mockAccess(page, { state: "anonymous" });
	await page.goto("/");
	const account = await openAccount(page);
	const theme = account.getByRole("switch", { name: "Modo escuro" });
	await expect(theme).toHaveAttribute("aria-checked", "true");
	await theme.click();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
	await expect(theme).toHaveAttribute("aria-checked", "false");
});

test("desktop and mobile light/dark navigation receipts are captured from synthetic state", async ({
	page,
}, testInfo) => {
	await mockAccess(page, { capabilities: allToolCapabilities });

	for (const receipt of [
		{
			name: "desktop-dark",
			viewport: { width: 1920, height: 1080 },
			colorScheme: "dark" as const,
		},
		{
			name: "desktop-light",
			viewport: { width: 1920, height: 1080 },
			colorScheme: "light" as const,
		},
		{
			name: "mobile-dark",
			viewport: { width: 390, height: 844 },
			colorScheme: "dark" as const,
		},
		{
			name: "mobile-light",
			viewport: { width: 390, height: 844 },
			colorScheme: "light" as const,
		},
	]) {
		await page.setViewportSize(receipt.viewport);
		await page.emulateMedia({ colorScheme: receipt.colorScheme });
		await page.goto("/");
		await openLauncher(page);
		await page.screenshot({
			path: testInfo.outputPath(`navigation-${receipt.name}.png`),
			fullPage: false,
		});
	}
});
