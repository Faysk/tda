import { expect, test, type Page } from "@playwright/test";

type StandaloneSurface = {
	id: string;
	route: string;
	canonical: string;
	exitHref: "/lore" | "/diario";
	skipTarget: string;
	noindex: boolean;
};

const surfaces: StandaloneSurface[] = [
	{
		id: "lore-astel",
		route: "/lore/astel",
		canonical: "https://dnd.faysk.dev/lore/astel",
		exitHref: "/lore",
		skipTarget: "#historia",
		noindex: false,
	},
	{
		id: "lore-noah",
		route: "/lore/noah",
		canonical: "https://dnd.faysk.dev/lore/noah",
		exitHref: "/lore",
		skipTarget: "#historia",
		noindex: false,
	},
	{
		id: "lore-d",
		route: "/lore/d",
		canonical: "https://dnd.faysk.dev/lore/d",
		exitHref: "/lore",
		skipTarget: "#top",
		noindex: true,
	},
	{
		id: "lore-yllith",
		route: "/lore/yllith",
		canonical: "https://dnd.faysk.dev/lore/yllith",
		exitHref: "/lore",
		skipTarget: "#historia",
		noindex: true,
	},
	{
		id: "diario-astel",
		route: "/diario/astel",
		canonical: "https://dnd.faysk.dev/diario/astel",
		exitHref: "/diario",
		skipTarget: "#diario",
		noindex: false,
	},
	{
		id: "diario-astel-leitura",
		route: "/diario/astel/leitura.html",
		canonical: "https://dnd.faysk.dev/diario/astel",
		exitHref: "/diario",
		skipTarget: "#conteudo",
		noindex: false,
	},
];

const viewportMatrix = [
	{ label: "320", width: 320, height: 800 },
	{ label: "390", width: 390, height: 844 },
	{ label: "1366", width: 1366, height: 768 },
	{ label: "1920", width: 1920, height: 1080 },
	{ label: "2560", width: 2560, height: 1440 },
	// 200% browser zoom on a 1366px-wide desktop yields an effective CSS
	// viewport close to half the width. This is deterministic in headless CI
	// and catches fixed-chrome/reflow failures without relying on browser UI.
	{ label: "zoom-200", width: 683, height: 384 },
] as const;

async function expectNoHorizontalOverflow(page: Page, label: string) {
	const metrics = await page.evaluate(() => ({
		scrollWidth: document.documentElement.scrollWidth,
		clientWidth: document.documentElement.clientWidth,
		bodyScrollWidth: document.body.scrollWidth,
		innerWidth: window.innerWidth,
		offenders: Array.from(document.body.querySelectorAll<HTMLElement>("*"))
			.flatMap((element) => {
				const style = getComputedStyle(element);
				if (style.display === "none" || style.visibility === "hidden") return [];
				const rect = element.getBoundingClientRect();
				if (rect.right <= window.innerWidth + 1) return [];
				return [{
					tag: element.tagName.toLowerCase(),
					id: element.id,
					className: typeof element.className === "string" ? element.className : "",
					right: Math.round(rect.right * 10) / 10,
					width: Math.round(rect.width * 10) / 10,
				}];
			})
			.slice(0, 8),
	}));
	expect(
		metrics.scrollWidth,
		`${label}: document overflow ${JSON.stringify(metrics)}`,
	).toBeLessThanOrEqual(metrics.clientWidth + 1);
	expect(
		metrics.bodyScrollWidth,
		`${label}: body overflow ${JSON.stringify(metrics)}`,
	).toBeLessThanOrEqual(metrics.innerWidth + 1);
}

async function expectFixedChromeInsideViewport(page: Page, label: string) {
	const offenders = await page.locator("body *").evaluateAll((nodes) => {
		const viewport = { width: window.innerWidth, height: window.innerHeight };
		return nodes.flatMap((node) => {
			const element = node as HTMLElement;
			if (element.classList.contains("skip-link")) return [];
			const style = getComputedStyle(element);
			if (!["fixed", "sticky"].includes(style.position)) return [];
			if (
				style.display === "none" ||
				style.visibility === "hidden" ||
				Number.parseFloat(style.opacity || "1") === 0
			)
				return [];
			const rect = element.getBoundingClientRect();
			if (rect.width < 1 || rect.height < 1) return [];
			const outside =
				rect.left < -1 ||
				rect.right > viewport.width + 1 ||
				rect.top < -1 ||
				rect.bottom > viewport.height + 1;
			if (!outside) return [];
			return [
				{
					tag: element.tagName.toLowerCase(),
					id: element.id,
					className: element.className,
					rect: {
						left: Math.round(rect.left),
						top: Math.round(rect.top),
						right: Math.round(rect.right),
						bottom: Math.round(rect.bottom),
					},
					viewport,
				},
			];
		});
	});
	expect(offenders, `${label}: fixed/sticky chrome outside viewport`).toEqual([]);
}

async function expectFragmentTargetsExist(page: Page, label: string) {
	const fragments = await page.locator('a[href^="#"]').evaluateAll((links) =>
		[
			...new Set(
				links
					.map((link) => link.getAttribute("href"))
					.filter((href): href is string => Boolean(href && href.length > 1)),
			),
		],
	);
	for (const fragment of fragments) {
		const targetId = decodeURIComponent(fragment.slice(1));
		expect(
			await page.evaluate(
				(id) => document.getElementById(id) !== null,
				targetId,
			),
			`${label}: dead fragment ${fragment}`,
		).toBe(true);
	}
}

async function expectSkipLinkWorks(
	page: Page,
	surface: StandaloneSurface,
	label: string,
) {
	const skip = page.locator(`a.skip-link[href="${surface.skipTarget}"]`);
	await expect(skip, `${label}: skip link`).toHaveCount(1);

	await page.keyboard.press("Tab");
	await expect(skip, `${label}: skip link must be first keyboard stop`).toBeFocused();
	await expect(skip, `${label}: focused skip link must be visible`).toBeInViewport();

	await expect
		.poll(async () => (await skip.boundingBox())?.y ?? Number.NEGATIVE_INFINITY, {
			message: `${label}: focused skip link must finish inside the viewport`,
		})
		.toBeGreaterThanOrEqual(-1);

	const box = await skip.boundingBox();
	expect(box, `${label}: focused skip link box`).not.toBeNull();
	if (box) {
		expect(box.x).toBeGreaterThanOrEqual(-1);
		expect(box.y).toBeGreaterThanOrEqual(-1);
		expect(box.x + box.width).toBeLessThanOrEqual(
			(page.viewportSize()?.width ?? 0) + 1,
		);
		expect(box.y + box.height).toBeLessThanOrEqual(
			(page.viewportSize()?.height ?? 0) + 1,
		);
	}

	await page.keyboard.press("Enter");
	await expect(page.locator(surface.skipTarget)).toBeInViewport();
}

for (const surface of surfaces) {
	test(`${surface.id}: canonical, privacy boundary, keyboard escape and viewport matrix`, async ({
		page,
	}, testInfo) => {
		test.skip(
			testInfo.project.name !== "desktop-1080p",
			"the standalone matrix is exercised once with explicit viewport changes",
		);
		test.setTimeout(180000);

		const pageErrors: string[] = [];
		page.on("pageerror", (error) => pageErrors.push(error.message));

		for (const viewport of viewportMatrix) {
			await page.setViewportSize({
				width: viewport.width,
				height: viewport.height,
			});
			const response = await page.goto(surface.route, {
				waitUntil: "domcontentloaded",
			});
			expect(response?.status(), `${surface.id} @ ${viewport.label}`).toBe(200);

			await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
				"href",
				surface.canonical,
			);

			const robotsHeader = response?.headers()["x-robots-tag"] ?? "";
			const robotsLocator = page.locator('meta[name="robots"]');
			const robotsMeta =
				(await robotsLocator.count()) > 0
					? (await robotsLocator.first().getAttribute("content")) ?? ""
					: "";
			if (surface.noindex) {
				expect(robotsHeader.toLowerCase()).toContain("noindex");
				expect(robotsMeta.toLowerCase()).toContain("noindex");
			} else {
				expect(robotsHeader.toLowerCase()).not.toContain("noindex");
				expect(robotsMeta.toLowerCase()).not.toContain("noindex");
			}

			await expect(
				page.locator(`a[href="${surface.exitHref}"]`).first(),
				`${surface.id}: clear return to TDA`,
			).toBeAttached();

			await expectSkipLinkWorks(
				page,
				surface,
				`${surface.id} @ ${viewport.label}`,
			);
			await expectFragmentTargetsExist(
				page,
				`${surface.id} @ ${viewport.label}`,
			);
			await expectNoHorizontalOverflow(
				page,
				`${surface.id} @ ${viewport.label}`,
			);
			await expectFixedChromeInsideViewport(
				page,
				`${surface.id} @ ${viewport.label}`,
			);

			await page.screenshot({
				path: testInfo.outputPath(
					`standalone-${surface.id}-${viewport.label}.png`,
				),
				fullPage: false,
			});
		}

		expect(pageErrors, `${surface.id}: browser errors`).toEqual([]);
	});
}

test("standalone catalog keeps curated lores discoverable without exposing a private campaign", async ({
	page,
}, testInfo) => {
	test.skip(testInfo.project.name !== "desktop-1080p");

	await page.goto("/lore");
	for (const slug of ["astel", "noah", "d", "yllith"] as const) {
		await expect(page.locator(`a[href="/lore/${slug}"]`)).toBeVisible();
	}
	for (const slug of ["d", "yllith"] as const) {
		const card = page.locator(`article[data-lore="${slug}"]`);
		await expect(card).toHaveAttribute("data-lore-campaign", "standalone");
		await expect(card).not.toContainText("Passos Retomados");
		await expect(card).not.toContainText("antes-que-seja-tarde");
	}

	await page.goto("/diario");
	await expect(page.locator('a[href="/diario/astel"]')).toBeVisible();

	await page.goto("/diario/astel");
	await expect(
		page.locator('a[href="/diario/astel/leitura.html"]:visible').first(),
	).toBeVisible();
});

test("Diário de Astel opens and paginates the reader across the viewport matrix", async ({
	page,
}, testInfo) => {
	test.skip(testInfo.project.name !== "desktop-1080p");
	test.setTimeout(180000);

	for (const viewport of viewportMatrix) {
		await page.setViewportSize({
			width: viewport.width,
			height: viewport.height,
		});
		await page.goto("/diario/astel", { waitUntil: "domcontentloaded" });

		const cover = page.locator("#cover-scene");
		const reader = page.locator("#reader");
		const book = page.locator("#book");
		const pageStatus = page.locator("#page-status");

		await expect(cover, `diario cover @ ${viewport.label}`).toBeVisible();
		await expect(reader, `diario reader starts closed @ ${viewport.label}`).toBeHidden();

		await page.locator("#open-book").click();

		await expect(cover, `diario cover closes @ ${viewport.label}`).toBeHidden();
		await expect(reader, `diario reader opens @ ${viewport.label}`).toBeVisible();
		await expect(book, `diario reader receives focus @ ${viewport.label}`).toBeFocused();
		await expect(pageStatus, `diario pagination status @ ${viewport.label}`).toContainText(
			/Página/,
		);
		await expect(page.locator("#font-size")).toBeVisible();
		await expect(page.locator("#next")).toBeEnabled();

		const firstStatus = (await pageStatus.textContent()) ?? "";
		await page.locator("#next").click();
		await expect(pageStatus).not.toHaveText(firstStatus);
		await expect(page.locator("#previous")).toBeEnabled();

		await page.locator("#contents").click();
		await expect(page.locator("#contents-dialog")).toBeVisible();
		await page.locator("#close-contents").click();
		await expect(page.locator("#contents-dialog")).toBeHidden();

		await expectNoHorizontalOverflow(
			page,
			`diario reader @ ${viewport.label}`,
		);
		await expectFixedChromeInsideViewport(
			page,
			`diario reader @ ${viewport.label}`,
		);

		await page.screenshot({
			path: testInfo.outputPath(
				`standalone-diario-astel-reader-${viewport.label}.png`,
			),
			fullPage: false,
		});
	}
});

test("D and Yllith preserve Cinemático/Leitura and keep the TDA escape available", async ({
	page,
}, testInfo) => {
	test.skip(testInfo.project.name !== "desktop-1080p");

	for (const lore of [
		{ route: "/lore/d", toggle: "#lore-mode-toggle" },
		{ route: "/lore/yllith", toggle: "#loreModeToggle" },
	]) {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto(lore.route, { waitUntil: "domcontentloaded" });

		const exit = page.locator('a[href="/lore"]').first();
		await expect(exit).toBeAttached();
		await page.locator(lore.toggle).click();
		await expect(page.locator("#reading-view")).toBeVisible();
		await expect(exit).toBeAttached();
		await expectNoHorizontalOverflow(page, `${lore.route} reading @ 390`);

		await page.keyboard.press("Shift+Tab");
		// The exact previous control differs by standalone identity; the invariant
		// is that keyboard focus stays in the document rather than disappearing.
		expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
	}
});

test("reduced motion removes continuous animation from every standalone surface", async ({
	page,
}, testInfo) => {
	test.skip(testInfo.project.name !== "desktop-1080p");
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.setViewportSize({ width: 390, height: 844 });

	for (const surface of surfaces) {
		await page.goto(surface.route, { waitUntil: "domcontentloaded" });
		const contract = await page.evaluate(() => {
			const infiniteAnimations = Array.from(document.querySelectorAll("*"))
				.filter((element) => {
					const style = getComputedStyle(element);
					return (
						style.animationName !== "none" &&
						style.animationIterationCount
							.split(",")
							.some((count) => count.trim() === "infinite")
					);
				})
				.map((element) => {
					const node = element as HTMLElement;
					return node.id || node.className || node.tagName.toLowerCase();
				});
			return {
				scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
				infiniteAnimations,
			};
		});
		expect(
			contract.infiniteAnimations,
			`${surface.id}: infinite animation under reduced motion`,
		).toEqual([]);
		expect(contract.scrollBehavior, `${surface.id}: reduced-motion scrolling`).toBe(
			"auto",
		);
	}
});
