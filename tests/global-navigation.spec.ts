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
