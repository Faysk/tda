import { expect, test } from "@playwright/test";

const capabilities = [
	"campaign.transcript.read",
	"campaign.local.process",
	"campaign.world.layout.edit",
	"narrative.review.read",
	"campaign.permissions.manage",
];

test("launcher keeps icon-first geometry from mobile three-column to narrow two-column layout", async ({
	page,
}) => {
	await page.route("**/api/auth/me", async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				state: "authenticated_linked",
				scope: { type: "campaign", id: "yuhara-main" },
				identity: { displayName: "Launcher Teste", avatarUrl: null },
				capabilities,
			}),
		});
	});

	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/");
	await page.getByRole("button", { name: "Abrir navegação" }).click();

	const navigation = page.getByRole("navigation", { name: "Navegação principal" });
	const firstGrid = navigation.locator(".product-launcher-grid").first();
	const firstLink = firstGrid.locator(".product-launcher-link").first();
	const firstIcon = firstLink.locator(".product-launcher-item-icon");
	const firstLabel = firstLink.locator("span");

	await expect(navigation).toBeVisible();
	for (const label of ["Transcrições", "Editar sessões", "Permissões"]) {
		await expect(
			navigation.getByRole("link", { name: label, exact: true }),
		).toBeVisible();
	}

	const style = await firstLink.evaluate((element) => {
		const computed = getComputedStyle(element);
		return {
			flexDirection: computed.flexDirection,
			alignItems: computed.alignItems,
			justifyContent: computed.justifyContent,
			textAlign: computed.textAlign,
			minHeight: Number.parseFloat(computed.minHeight),
		};
	});
	expect(style).toMatchObject({
		flexDirection: "column",
		alignItems: "center",
		justifyContent: "center",
		textAlign: "center",
	});
	expect(style.minHeight).toBeGreaterThanOrEqual(88);

	const iconBox = await firstIcon.boundingBox();
	const labelBox = await firstLabel.boundingBox();
	expect(iconBox).not.toBeNull();
	expect(labelBox).not.toBeNull();
	if (iconBox && labelBox) {
		expect(iconBox.width).toBeGreaterThanOrEqual(30);
		expect(iconBox.height).toBeGreaterThanOrEqual(30);
		expect(labelBox.y).toBeGreaterThanOrEqual(iconBox.y + iconBox.height - 1);
	}

	const columnsAt390 = await firstGrid.evaluate(
		(element) =>
			getComputedStyle(element).gridTemplateColumns
				.split(/\s+/u)
				.filter(Boolean).length,
	);
	expect(columnsAt390).toBe(3);

	await page.setViewportSize({ width: 320, height: 800 });
	const columnsAt320 = await firstGrid.evaluate(
		(element) =>
			getComputedStyle(element).gridTemplateColumns
				.split(/\s+/u)
				.filter(Boolean).length,
	);
	expect(columnsAt320).toBe(2);
});
