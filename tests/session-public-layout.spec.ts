import { writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

type Box = { x: number; y: number; width: number; height: number };

const viewports = [
	{ width: 1366, height: 768, label: "1366x768" },
	{ width: 1920, height: 1080, label: "1920x1080" },
	{ width: 2560, height: 1440, label: "2560x1440" },
	{ width: 390, height: 844, label: "390x844" },
	{ width: 320, height: 800, label: "320x800" },
] as const;

async function requiredBox(locator: ReturnType<Page["locator"]>) {
	const value = await locator.boundingBox();
	expect(value).not.toBeNull();
	return value as Box;
}

function overlaps(a: Box, b: Box) {
	return (
		a.x < b.x + b.width &&
		a.x + a.width > b.x &&
		a.y < b.y + b.height &&
		a.y + a.height > b.y
	);
}

function horizontalMargins(box: Box, viewportWidth: number) {
	return {
		left: box.x,
		right: viewportWidth - (box.x + box.width),
	};
}

function expectSymmetricMargins(box: Box, viewportWidth: number, tolerance = 2) {
	const margins = horizontalMargins(box, viewportWidth);
	expect(Math.abs(margins.left - margins.right)).toBeLessThanOrEqual(tolerance);
	return margins;
}

function expectSameHorizontalAxis(a: Box, b: Box, tolerance = 2) {
	expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(tolerance);
	expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(tolerance);
}

async function sharedKeyline(page: Page) {
	return page.evaluate(() => {
		const styles = getComputedStyle(document.documentElement);
		const layoutMax = Number.parseFloat(styles.getPropertyValue("--ds-layout-max"));
		const probe = document.createElement("div");
		probe.style.cssText =
			"position:fixed;visibility:hidden;width:var(--ds-page-gutter);height:0";
		document.body.append(probe);
		const gutter = probe.getBoundingClientRect().width;
		probe.remove();
		const layoutWidth = Math.min(innerWidth, layoutMax);
		return {
			x: Math.max(0, (innerWidth - layoutWidth) / 2) + gutter,
			contentWidth: layoutWidth - gutter * 2,
		};
	});
}

async function expectNoHorizontalOverflow(page: Page) {
	const overflow = await page.evaluate(() => ({
		scrollWidth: document.documentElement.scrollWidth,
		clientWidth: document.documentElement.clientWidth,
	}));
	expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

test("public Sessions keeps archive value in the first viewport and reader measure healthy", async ({
	page,
}, testInfo) => {
	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		await page.goto("/sessoes");

		const keyline = await sharedKeyline(page);
		const archiveTitle = page.getByRole("heading", {
			level: 1,
			name: "Todas as campanhas",
		});
		const archiveHero = page.locator("[data-session-archive-hero]");
		const archiveRail = page.locator("[data-session-archive-rail]");
		const archiveToolbar = page.locator("[data-session-archive-toolbar]");
		const archiveResults = page.locator("[data-session-archive-results]");
		const archiveGrid = page.locator('[data-session-view="grid"]');
		const stats = page.locator('dl[aria-label="Resumo de todas as campanhas"]');
		const firstCard = page.locator('[data-session-card="grid"]').first();
		const cardImage = firstCard.locator("img").first();
		const fallback = firstCard.getByText("TDA", { exact: true });
		const brand = page.locator(".brand");
		const account = page.locator(".account-menu-trigger");

		await expect(firstCard).toBeVisible();
		if ((await cardImage.count()) > 0) {
			await expect(cardImage).toBeVisible();
			await expect
				.poll(() =>
					cardImage.evaluate((element) => {
						const image = element as HTMLImageElement;
						return image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
					}),
				)
				.toBe(true);
			await expect(fallback).toHaveCount(0);
		} else {
			await expect(fallback).toBeVisible();
		}
		const [
			titleBox,
			heroBox,
			railBox,
			toolbarBox,
			resultsBox,
			gridBox,
			statsBox,
			cardBox,
			brandBox,
			accountBox,
		] = await Promise.all([
			requiredBox(archiveTitle),
			requiredBox(archiveHero),
			requiredBox(archiveRail),
			requiredBox(archiveToolbar),
			requiredBox(archiveResults),
			requiredBox(archiveGrid),
			requiredBox(stats),
			requiredBox(firstCard),
			requiredBox(brand),
			requiredBox(account),
		]);

		expect(Math.abs(titleBox.x - keyline.x)).toBeLessThanOrEqual(2);
		const railMargins = expectSymmetricMargins(railBox, viewport.width);
		expectSameHorizontalAxis(toolbarBox, railBox);
		expectSameHorizontalAxis(resultsBox, railBox);
		expectSameHorizontalAxis(gridBox, railBox);
		expect(Math.abs(cardBox.x - railBox.x)).toBeLessThanOrEqual(2);
		expect(overlaps(titleBox, brandBox)).toBeFalsy();
		expect(overlaps(titleBox, accountBox)).toBeFalsy();
		expect(cardBox.y).toBeLessThan(viewport.height);
		expect(statsBox.height).toBeLessThan(heroBox.height * 0.4);
		expect(heroBox.height).toBeLessThanOrEqual(viewport.width <= 390 ? 540 : 560);
		if (viewport.width >= 1920) {
			expect(railBox.width).toBeGreaterThanOrEqual(1538);
			expect(railBox.width).toBeLessThanOrEqual(1542);
			expect(railBox.x).toBeGreaterThan(keyline.x);
			expect(cardBox.width).toBeLessThanOrEqual(520);
		}
		await expectNoHorizontalOverflow(page);

		await page.getByRole("button", { name: "Visualização em lista" }).click();
		const archiveList = page.locator('[data-session-view="list"]');
		const firstListRow = page.locator('[data-session-card="list"]').first();
		await expect(archiveList).toBeVisible();
		const [listBox, listRowBox] = await Promise.all([
			requiredBox(archiveList),
			requiredBox(firstListRow),
		]);
		expectSameHorizontalAxis(listBox, railBox);
		expectSameHorizontalAxis(listRowBox, railBox);
		expectSymmetricMargins(listBox, viewport.width);
		await expectNoHorizontalOverflow(page);

		await writeFile(
			testInfo.outputPath("session-layout-archive-" + viewport.label + ".json"),
			JSON.stringify(
				{
					surface: "archive",
					viewport,
					title: titleBox,
					hero: heroBox,
					stats: statsBox,
					rail: railBox,
					railMargins,
					toolbar: toolbarBox,
					results: resultsBox,
					grid: gridBox,
					firstCard: cardBox,
					list: listBox,
					firstListRow: listRowBox,
				},
				null,
				2,
			),
			"utf8",
		);
		await page.screenshot({
			path: testInfo.outputPath("session-layout-archive-" + viewport.label + ".png"),
			fullPage: true,
		});

		await page.goto("/sessoes/layout-contract-synthetic");
		const readerKeyline = await sharedKeyline(page);
		const readerTitle = page.getByRole("heading", {
			level: 1,
			name: /Sessão Sintética de Layout/u,
		});
		const readerHero = page.locator("[data-session-reader-hero]");
		const back = page.getByRole("link", { name: /Arquivo de Crônicas da Mesa/u });
		const story = page.locator(".story-content").first();
		const previousLink = page.getByRole("link", { name: /Sessão anterior/u });
		const nextLink = page.getByRole("link", { name: /Próxima sessão/u });
		const readerBrand = page.locator(".brand");
		const readerAccount = page.locator(".account-menu-trigger");

		const [
			readerTitleBox,
			readerHeroBox,
			backBox,
			storyBox,
			previousBox,
			nextBox,
			readerBrandBox,
			readerAccountBox,
		] = await Promise.all([
			requiredBox(readerTitle),
			requiredBox(readerHero),
			requiredBox(back),
			requiredBox(story),
			requiredBox(previousLink),
			requiredBox(nextLink),
			requiredBox(readerBrand),
			requiredBox(readerAccount),
		]);

		expect(Math.abs(readerTitleBox.x - readerKeyline.x)).toBeLessThanOrEqual(2);
		expect(Math.abs(readerTitleBox.x - backBox.x)).toBeLessThanOrEqual(2);
		expect(overlaps(readerTitleBox, readerBrandBox)).toBeFalsy();
		expect(overlaps(readerTitleBox, readerAccountBox)).toBeFalsy();
		if (viewport.width >= 1366) {
			expect(storyBox.width).toBeGreaterThanOrEqual(760);
			expect(storyBox.width).toBeLessThanOrEqual(900);
			expect(previousBox.height).toBeLessThanOrEqual(160);
			expect(nextBox.height).toBeLessThanOrEqual(160);
		} else {
			expect(storyBox.width).toBeLessThanOrEqual(viewport.width - 40 + 1);
			expect(previousBox.height).toBeLessThanOrEqual(130);
			expect(nextBox.height).toBeLessThanOrEqual(130);
		}
		await expectNoHorizontalOverflow(page);

		await writeFile(
			testInfo.outputPath("session-layout-reader-" + viewport.label + ".json"),
			JSON.stringify(
				{
					surface: "reader",
					viewport,
					title: readerTitleBox,
					hero: readerHeroBox,
					back: backBox,
					story: storyBox,
					previous: previousBox,
					next: nextBox,
				},
				null,
				2,
			),
			"utf8",
		);
		await page.screenshot({
			path: testInfo.outputPath("session-layout-reader-" + viewport.label + ".png"),
			fullPage: true,
		});
	}
});

test("Sessions archive keyline survives a 200%-equivalent reflow viewport", async ({
	page,
}) => {
	// Browser zoom to 200% halves the available CSS-pixel viewport. A 1366px
	// desktop therefore exercises the same responsive layout at ~683 CSS px.
	await page.setViewportSize({ width: 683, height: 384 });
	await page.goto("/sessoes");

	const rail = await requiredBox(page.locator("[data-session-archive-rail]"));
	const toolbar = await requiredBox(page.locator("[data-session-archive-toolbar]"));
	const results = await requiredBox(page.locator("[data-session-archive-results]"));
	const grid = await requiredBox(page.locator('[data-session-view="grid"]'));

	expectSymmetricMargins(rail, 683);
	expectSameHorizontalAxis(toolbar, rail);
	expectSameHorizontalAxis(results, rail);
	expectSameHorizontalAxis(grid, rail);
	await expectNoHorizontalOverflow(page);

	await page.getByRole("button", { name: "Visualização em lista" }).click();
	const list = await requiredBox(page.locator('[data-session-view="list"]'));
	expectSameHorizontalAxis(list, rail);
	expectSymmetricMargins(list, 683);
	await expectNoHorizontalOverflow(page);
});

test("Sessions public geometry survives dark/light themes and reduced motion", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.emulateMedia({ reducedMotion: "reduce" });

	for (const theme of ["dark", "light"] as const) {
		await page.goto("/sessoes");
		await page.evaluate((value) => localStorage.setItem("tda-theme", value), theme);
		await page.reload();
		await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
		await expectNoHorizontalOverflow(page);

		const archiveCard = page.locator('[data-session-view="grid"] article').first();
		expect(
			await archiveCard.evaluate(
				(element) => getComputedStyle(element).transitionDuration,
			),
		).toBe("0s");

		const archiveColors = await page.locator("body").evaluate((element) => {
			const styles = getComputedStyle(element);
			return { background: styles.backgroundColor, foreground: styles.color };
		});
		expect(archiveColors.background).not.toBe(archiveColors.foreground);

		await page.goto("/sessoes/layout-contract-synthetic");
		await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
		await expectNoHorizontalOverflow(page);
		const previousLink = page.getByRole("link", { name: /Sessão anterior/u });
		expect(
			await previousLink.evaluate(
				(element) => getComputedStyle(element).transitionDuration,
			),
		).toBe("0s");
	}
});

test("unavailable session state respects the public structural keyline", async ({
	page,
}, testInfo) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/sessoes/layout-contract-unavailable");
	const keyline = await sharedKeyline(page);
	const heading = page.getByRole("heading", {
		level: 1,
		name: "Esta sessão está temporariamente indisponível.",
	});
	await expect(heading).toBeVisible();

	const [headingBox, brandBox, triggerBox] = await Promise.all([
		requiredBox(heading),
		requiredBox(page.locator(".brand")),
		requiredBox(page.locator(".account-menu-trigger")),
	]);
	expect(Math.abs(headingBox.x - keyline.x)).toBeLessThanOrEqual(2);
	expect(headingBox.y).toBeGreaterThan(brandBox.y + brandBox.height);
	expect(headingBox.y).toBeGreaterThan(triggerBox.y + triggerBox.height);
	await expectNoHorizontalOverflow(page);

	await page.screenshot({
		path: testInfo.outputPath("session-layout-unavailable-390x844.png"),
		fullPage: true,
	});
});


test("historical campaign aliases permanently redirect shared session links without crossing campaigns", async ({
	page,
}) => {
	const canonicalPath = "/campanhas/cronicas-da-mesa/sessoes/shared-session";
	for (const alias of [
		"cronicas-da-mesa-antiga",
		"cronicas-da-mesa-intermediaria",
	]) {
		const response = await page.request.get(
			`/campanhas/${alias}/sessoes/shared-session`,
			{ maxRedirects: 0 },
		);
		expect(response.status()).toBe(308);
		const location = response.headers().location;
		expect(location).toBeTruthy();
		expect(new URL(location!, "http://127.0.0.1:3106").pathname).toBe(
			canonicalPath,
		);
	}

	await page.goto("/campanhas/cronicas-da-mesa-antiga/sessoes/shared-session");
	await expect(page).toHaveURL(new RegExp(`${canonicalPath}$`, "u"));
	await expect(
		page.getByRole("heading", {
			level: 1,
			name: "A memória mais recente do arquivo sintético",
		}),
	).toBeVisible();
	await expect(
		page.getByText("A memória global mais recente vem da campanha B", {
			exact: true,
		}),
	).toHaveCount(0);

	const canonicalUrl =
		"https://dnd.faysk.dev/campanhas/cronicas-da-mesa/sessoes/shared-session";
	await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
		"href",
		canonicalUrl,
	);
	await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
		"content",
		canonicalUrl,
	);
});

test("retired, private and archived campaign routes fail closed while dependency outages stay unavailable", async ({
	page,
}) => {
	for (const routeKey of [
		"cronicas-da-mesa-retirada",
		"fixture-private",
		"fixture-private-antiga",
		"fixture-archived",
		"fixture-archived-antiga",
	]) {
		const response = await page.request.get(
			`/campanhas/${routeKey}/sessoes/shared-session`,
			{ maxRedirects: 0 },
		);
		expect(response.status(), routeKey).toBe(404);
	}

	const response = await page.goto(
		"/campanhas/fixture-dependency-unavailable/sessoes/shared-session",
	);
	expect(response?.status()).toBe(200);
	await expect(
		page.getByRole("heading", {
			level: 1,
			name: "Esta sessão está temporariamente indisponível.",
		}),
	).toBeVisible();
	await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
		"content",
		/noindex/u,
	);
	await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
		"content",
		/nofollow/u,
	);
	await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
});

test("session arc filters share normalized identity without crossing campaign boundaries", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/e2e-fixtures/session-archive-scope");

	const scoped = page.locator(
		'[data-session-scope-fixture="arc-identity-scoped"]',
	);
	const scopedArc = scoped.getByRole("combobox", { name: "Filtrar por arco" });

	await expect(scopedArc.locator("option")).toHaveCount(4);
	expect(
		(await scopedArc.locator("option").allTextContents()).filter((label) =>
			label.toLocaleLowerCase("pt-BR").includes("valcinzento"),
		),
	).toHaveLength(1);

	await scopedArc.selectOption({ label: "VALCINZENTO E O CORAÇÃO-RAIZ" });
	await expect(scoped.locator('[data-session-card="grid"]')).toHaveCount(4);
	await expect(scoped.locator("[data-session-archive-results] strong")).toHaveText(
		"4",
	);

	await scoped.getByRole("button", { name: "Visualização em lista" }).click();
	await expect(scoped.locator('[data-session-card="list"]')).toHaveCount(4);

	await scoped.getByRole("button", { name: "Limpar filtros" }).click();
	await expect(scoped.locator('[data-session-card="list"]')).toHaveCount(6);
	await scoped.getByLabel("Ordenar por").selectOption("title");
	await expect(scoped.locator('[data-session-card="list"]')).toHaveCount(6);

	const aggregate = page.locator(
		'[data-session-scope-fixture="arc-identity-aggregate"]',
	);
	const aggregateCampaign = aggregate.getByRole("combobox", {
		name: "Filtrar por campanha",
	});
	const aggregateArc = aggregate.getByRole("combobox", {
		name: "Filtrar por arco",
	});
	const aggregateArcLabels = await aggregateArc.locator("option").allTextContents();

	const aggregateValcinzentoLabels = aggregateArcLabels.filter((label) =>
		label.toLocaleLowerCase("pt-BR").includes("valcinzento"),
	);
	expect(aggregateValcinzentoLabels).toHaveLength(2);
	expect(aggregateValcinzentoLabels).toEqual(
		expect.arrayContaining([
			"VALCINZENTO E O CORAÇÃO-RAIZ — Campanha Única de Teste",
			"Valcinzento e o Coração-Raiz — Campanha com Conteúdo",
		]),
	);

	await aggregateArc.selectOption({
		label: "VALCINZENTO E O CORAÇÃO-RAIZ — Campanha Única de Teste",
	});
	await expect(aggregate.locator('[data-session-card="grid"]')).toHaveCount(4);

	await aggregateCampaign.selectOption("fixture-with-content");
	await expect(aggregate.locator('[data-session-card="grid"]')).toHaveCount(1);
	await expect(aggregateArc.locator("option")).toHaveCount(2);
	await aggregateArc.selectOption({ label: "Valcinzento e o Coração-Raiz" });
	await expect(aggregate.locator('[data-session-card="grid"]')).toHaveCount(1);

	await aggregateCampaign.selectOption("fixture-only-campaign");
	await expect(aggregate.locator('[data-session-card="grid"]')).toHaveCount(6);
	await expect(aggregateArc.locator("option")).toHaveCount(4);
	await aggregateArc.selectOption({ label: "VALCINZENTO E O CORAÇÃO-RAIZ" });
	await expect(aggregate.locator('[data-session-card="grid"]')).toHaveCount(4);

	await page.reload();
	const reloadedScoped = page.locator(
		'[data-session-scope-fixture="arc-identity-scoped"]',
	);
	await expect(reloadedScoped.locator('[data-session-card="grid"]')).toHaveCount(6);
	expect(
		(
			await reloadedScoped
				.getByRole("combobox", { name: "Filtrar por arco" })
				.locator("option")
				.allTextContents()
		).filter((label) => label.toLocaleLowerCase("pt-BR").includes("valcinzento")),
	).toHaveLength(1);

	await page.goto("/e2e-fixtures/session-archive-scope?history-probe=1");
	await page.goBack();
	await expect(
		page.locator('[data-session-scope-fixture="arc-identity-scoped"]'),
	).toBeVisible();
});



test("long session summaries expose compact stable section navigation without burdening short readers", async ({
	page,
}, testInfo) => {
	test.setTimeout(120000);
	const longPath =
		"/campanhas/cronicas-da-mesa/sessoes/layout-contract-long";

	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto(`${longPath}#secao-capitulo-8`);
	const deepLinkedHeading = page.getByRole("heading", { name: "Capítulo 8" });
	await expect(deepLinkedHeading).toHaveAttribute("id", "secao-capitulo-8");
	await expect(deepLinkedHeading).toBeInViewport();
	const deepLinkedBox = await deepLinkedHeading.boundingBox();
	expect(deepLinkedBox).not.toBeNull();
	expect(deepLinkedBox?.y ?? -1).toBeGreaterThanOrEqual(0);

	const keyboardNavigation = page.getByRole("navigation", {
		name: "Nesta sessão",
	});
	const keyboardDisclosure = keyboardNavigation.locator("details");
	const keyboardSummary = keyboardDisclosure.locator("summary");
	await keyboardSummary.focus();
	await expect(keyboardSummary).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(keyboardDisclosure).toHaveAttribute("open", "");

	await expect(
		page.getByRole("navigation", { name: "Navegação entre sessões" }),
	).toBeVisible();
	const archiveLink = page.getByRole("link", {
		name: /Arquivo de Crônicas da Mesa/u,
	});
	await archiveLink.focus();
	await expect(archiveLink).toBeFocused();
	await archiveLink.click();
	await expect(page).toHaveURL(
		/\/campanhas\/cronicas-da-mesa\/sessoes$/u,
	);
	await page.goBack();
	await expect(page).toHaveURL(
		new RegExp(`${longPath}#secao-capitulo-8$`, "u"),
	);

	for (const viewport of [
		{ width: 320, height: 800 },
		{ width: 390, height: 844 },
		{ width: 683, height: 384 },
		{ width: 1366, height: 768 },
	]) {
		await page.setViewportSize(viewport);
		await page.goto(longPath);

		const navigation = page.getByRole("navigation", { name: "Nesta sessão" });
		await expect(navigation).toBeVisible();
		const disclosure = navigation.locator("details");
		await expect(disclosure).not.toHaveAttribute("open", "");
		await disclosure.locator("summary").click();

		const select = navigation.getByRole("combobox", {
			name: "Ir para uma seção",
		});
		await expect(select).toBeVisible();
		expect(await select.locator("option").count()).toBeGreaterThan(12);

		const repeated = page.getByRole("heading", {
			name: "Capítulo repetido",
		});
		await expect(repeated).toHaveCount(2);
		const firstId = await repeated.nth(0).getAttribute("id");
		const secondId = await repeated.nth(1).getAttribute("id");
		expect(firstId).toBeTruthy();
		expect(secondId).toBeTruthy();
		expect(firstId).not.toBe(secondId);
		if (!secondId) throw new Error("Second repeated heading is missing its stable ID");

		await select.selectOption(secondId);
		await expect(page).toHaveURL(new RegExp(`#${secondId}$`, "u"));
		await expect(repeated.nth(1)).toBeInViewport();
		await expect(repeated.nth(1)).toBeFocused();
		const box = await repeated.nth(1).boundingBox();
		expect(box).not.toBeNull();
		expect(box?.y ?? 0).toBeGreaterThanOrEqual(0);

		await page.goBack();
		await expect(page).toHaveURL(new RegExp(`${longPath}$`, "u"));
		await expectNoHorizontalOverflow(page);

		await page.screenshot({
			path: testInfo.outputPath(
				`session-long-outline-${viewport.width}x${viewport.height}.png`,
			),
			fullPage: false,
		});
	}

	await page.goto("/sessoes/layout-contract-synthetic");
	await expect(
		page.getByRole("navigation", { name: "Nesta sessão" }),
	).toHaveCount(0);
});
