import { expect, test } from "@playwright/test";

const kinds = [
	["personagens", "Personagens", "portrait"],
	["npcs", "NPCs", "portrait"],
	["lugares", "Lugares", "landscape"],
	["faccoes", "Facções", "emblem"],
	["quests", "Quests", "quest"],
	["musicas", "Músicas", "music"],
] as const;

async function expectNoHorizontalOverflow(
	page: import("@playwright/test").Page,
) {
	const geometry = await page.evaluate(() => ({
		scrollWidth: document.documentElement.scrollWidth,
		clientWidth: document.documentElement.clientWidth,
	}));
	expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
}

test("six public archives keep one technical base while exposing type context", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1366, height: 768 });

	for (const [kind, label, visualKind] of kinds) {
		await page.goto(`/e2e-fixtures/lore-catalog?kind=${kind}&scenario=one`);
		const archive = page.locator(`[data-lore-index="${kind}"]`);
		await expect(archive).toBeVisible();
		await expect(archive).toHaveAttribute("data-visual-kind", visualKind);\n\t\tawait expect(archive).toHaveAttribute("data-layout-family", "editorial");\n\t\tawait expect(archive).toHaveAttribute("data-layout-role", "editorial");

		const context = page.getByRole("navigation", {
			name: "Contexto de exploração",
		});
		await expect(context.getByRole("link", { name: "Mundo" })).toHaveAttribute(
			"href",
			"/mundo",
		);
		await expect(context.locator('[aria-current="page"]')).toHaveText(label);
		await expect(page.locator("[data-lore-card]")).toHaveCount(1);
		await expectNoHorizontalOverflow(page);
	}
});

test("catalog content starts early and uses extra desktop width without stretching copy", async ({
	page,
}) => {
	const widths: number[] = [];
	for (const viewport of [
		{ width: 320, height: 800 },
		{ width: 390, height: 844 },
		{ width: 1366, height: 768 },
		{ width: 1920, height: 1080 },
		{ width: 2560, height: 1440 },
	]) {
		await page.setViewportSize(viewport);
		await page.goto("/e2e-fixtures/lore-catalog?kind=personagens");
		const firstCard = page.locator("[data-lore-card]").first();
		await expect(firstCard).toBeVisible();
		const box = await firstCard.boundingBox();
		expect(box).not.toBeNull();
		if (box) {
			expect(box.y).toBeLessThan(viewport.height * 0.82);
			if (viewport.width >= 1366) {
				const gridBox = await firstCard.locator("..").boundingBox();
				expect(gridBox).not.toBeNull();
				if (gridBox) widths.push(gridBox.width);
			}
		}
		const intro = page
			.getByRole("heading", { level: 1, name: "Personagens" })
			.locator("..");
		const introBox = await intro.boundingBox();
		expect(introBox?.width ?? 9999).toBeLessThanOrEqual(820);
		await expectNoHorizontalOverflow(page);
	}
	expect(widths).toHaveLength(3);
	expect(widths[1]).toBeGreaterThan(widths[0] + 80);\n\texpect(Math.abs(widths[2] - widths[1])).toBeLessThanOrEqual(4);
});

test("catalog states cover empty, compact fallback, media and long titles", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });

	await page.goto("/e2e-fixtures/lore-catalog?scenario=empty");
	await expect(page.getByText("0 registros públicos", { exact: true })).toBeVisible();
	await expect(page.getByText("Nenhum personagem publicado ainda.")).toBeVisible();

	await page.goto("/e2e-fixtures/lore-catalog?scenario=no-summary");
	const compact = page.locator('[data-lore-card][data-rich="false"]');
	await expect(compact).toBeVisible();
	await expect(compact.locator('[data-has-media="false"]')).toBeVisible();

	await page.goto("/e2e-fixtures/lore-catalog?scenario=with-media");
	const mediaCard = page.locator('[data-lore-card][data-rich="true"]');
	await expect(mediaCard.locator('[data-has-media="true"] img')).toBeVisible();
	await expect(mediaCard.getByAltText(/Arte sintética/)).toBeVisible();

	await page.goto("/e2e-fixtures/lore-catalog?scenario=long-title");
	const heading = page.getByRole("heading", {
		level: 2,
		name: /A Cartógrafa das Sete Fronteiras/,
	});
	await expect(heading).toBeVisible();
	expect(
		await heading.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
	).toBeTruthy();
	await expectNoHorizontalOverflow(page);
});

test("profile without media stays deliberate, contextual and compact", async ({
	page,
}) => {
	for (const viewport of [
		{ width: 390, height: 844 },
		{ width: 1920, height: 1080 },
	]) {
		await page.setViewportSize(viewport);
		await page.goto("/e2e-fixtures/lore-profile");

		const context = page.getByRole("navigation", {
			name: "Contexto de exploração",
		});
		await expect(context.getByRole("link", { name: "Mundo" })).toHaveAttribute(
			"href",
			"/mundo",
		);
		await expect(context.getByRole("link", { name: "Personagens" })).toHaveAttribute(
			"href",
			"/personagens",
		);
		await expect(context.locator('[aria-current="page"]')).toHaveText(
			"A Cartógrafa do Horizonte",
		);

		const hero = page.locator('header[data-has-media="false"]');
		await expect(hero).toBeVisible();
		const heroBox = await hero.boundingBox();
		expect(heroBox).not.toBeNull();
		if (heroBox) {
			expect(heroBox.height).toBeLessThan(viewport.width < 700 ? 620 : 560);
		}
		await expect(page.getByRole("heading", { name: "Visão geral" })).toBeVisible();
		await expectNoHorizontalOverflow(page);
	}
});
