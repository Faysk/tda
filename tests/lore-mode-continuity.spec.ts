import { expect, test, type Locator, type Page } from "@playwright/test";

type LoreModeCase = Readonly<{
	name: "D" | "Yllith";
	route: "/lore/d" | "/lore/yllith";
	toggle: string;
	cinematic: string;
	reading: string;
	readingText: RegExp;
}>;

const cases: readonly LoreModeCase[] = [
	{
		name: "D",
		route: "/lore/d",
		toggle: "#lore-mode-toggle",
		cinematic: "#e-se",
		reading: "#read-what-if",
		readingText: /E se/u,
	},
	{
		name: "Yllith",
		route: "/lore/yllith",
		toggle: "#loreModeToggle",
		cinematic: "#eco",
		reading: "#read-nem-tudo-era-perfeito",
		readingText: /Nem tudo era perfeito/u,
	},
];

const desktopMatrix = [
	{ label: "320", width: 320, height: 800 },
	{ label: "390", width: 390, height: 844 },
	{ label: "desktop", width: 1366, height: 768 },
	{ label: "zoom-200", width: 683, height: 384 },
] as const;

const ANCHOR_OFFSET = 110;
const POSITION_TOLERANCE = 0.14;

async function scrollSectionToProgress(
	page: Page,
	selector: string,
	progress: number,
) {
	await page.locator(selector).evaluate(
		(element, { anchorOffset, requestedProgress }) => {
			const rect = element.getBoundingClientRect();
			const targetY =
				window.scrollY +
				rect.top +
				rect.height * requestedProgress -
				anchorOffset;
			const scroller = document.scrollingElement || document.documentElement;
			if (scroller) scroller.scrollTop = Math.max(0, targetY);
			else window.scrollTo(0, Math.max(0, targetY));
		},
		{ anchorOffset: ANCHOR_OFFSET, requestedProgress: progress },
	);
	await page.waitForTimeout(50);
}

async function sectionProgress(page: Page, selector: string) {
	return page.locator(selector).evaluate((element, anchorOffset) => {
		const rect = element.getBoundingClientRect();
		if (rect.height <= 0) return -1;
		return Math.min(1, Math.max(0, (anchorOffset - rect.top) / rect.height));
	}, ANCHOR_OFFSET);
}

async function expectApproximateProgress(
	page: Page,
	selector: string,
	expected: number,
	label: string,
) {
	await expect
		.poll(() => sectionProgress(page, selector), {
			message: `${label}: mapped position should remain approximately stable`,
		})
		.toBeGreaterThanOrEqual(Math.max(0, expected - POSITION_TOLERANCE));
	const actual = await sectionProgress(page, selector);
	expect(
		actual,
		`${label}: mapped position ${actual.toFixed(3)} vs ${expected.toFixed(3)}`,
	).toBeLessThanOrEqual(Math.min(1, expected + POSITION_TOLERANCE));
}

async function expectModeSemantics(toggle: Locator, reading: boolean) {
	await expect(toggle).toHaveAttribute("role", "switch");
	await expect(toggle).toHaveAttribute("aria-checked", String(reading));
	await expect(toggle).toHaveAttribute(
		"aria-label",
		reading ? "Ativar modo Cinemático" : "Ativar modo Leitura",
	);
}

async function roundTrip(
	page: Page,
	lore: LoreModeCase,
	label: string,
	testInfo?: { outputPath: (name: string) => string },
) {
	const response = await page.goto(lore.route, { waitUntil: "domcontentloaded" });
	expect(response?.status(), `${label}: route`).toBe(200);

	const toggle = page.locator(lore.toggle);
	await expect(toggle).toBeVisible();
	await expectModeSemantics(toggle, false);

	await scrollSectionToProgress(page, lore.cinematic, 0.56);
	await expect
		.poll(() => sectionProgress(page, lore.cinematic), {
			message: `${label}: cinematic anchor should settle before switching modes`,
		})
		.toBeGreaterThan(0.2);
	const cinematicProgress = await sectionProgress(page, lore.cinematic);
	expect(cinematicProgress).toBeLessThan(0.9);

	if (testInfo && label.includes("@ 390")) {
		await page.screenshot({
			path: testInfo.outputPath(
				`lore-mode-${lore.name.toLowerCase()}-cinematic-390.png`,
			),
			fullPage: false,
		});
	}

	await toggle.click();
	await expectModeSemantics(toggle, true);
	await expect(page.locator("#reading-view")).toBeVisible();
	await expect(page.locator(lore.reading)).toContainText(lore.readingText);
	await expect(toggle).toBeFocused();
	await expectApproximateProgress(
		page,
		lore.reading,
		cinematicProgress,
		`${label}: cinematic -> reading`,
	);

	await scrollSectionToProgress(page, lore.reading, 0.66);
	const readingProgress = await sectionProgress(page, lore.reading);
	expect(readingProgress).toBeGreaterThan(0.25);
	expect(readingProgress).toBeLessThan(0.92);

	if (testInfo && label.includes("@ 390")) {
		await page.screenshot({
			path: testInfo.outputPath(
				`lore-mode-${lore.name.toLowerCase()}-reading-390.png`,
			),
			fullPage: false,
		});
	}

	await toggle.click();
	await expectModeSemantics(toggle, false);
	await expect(toggle).toBeFocused();
	await expectApproximateProgress(
		page,
		lore.cinematic,
		readingProgress,
		`${label}: reading -> cinematic`,
	);

	await toggle.click();
	await expectModeSemantics(toggle, true);
	await expect(toggle).toBeFocused();
	await expectApproximateProgress(
		page,
		lore.reading,
		readingProgress,
		`${label}: second reading restore`,
	);

	await page.reload({ waitUntil: "domcontentloaded" });
	await expectModeSemantics(page.locator(lore.toggle), false);
}

test("D baseline and Yllith reference preserve chapter position and focus across the viewport matrix", async ({
	page,
}, testInfo) => {
	test.skip(
		testInfo.project.name !== "desktop-1080p",
		"explicit viewport matrix runs once on the desktop browser project",
	);
	test.setTimeout(180000);

	for (const viewport of desktopMatrix) {
		await page.setViewportSize({ width: viewport.width, height: viewport.height });
		for (const lore of cases) {
			await roundTrip(
				page,
				lore,
				`${lore.name} @ ${viewport.label}`,
				testInfo,
			);
			const overflow = await page.evaluate(
				() =>
					document.documentElement.scrollWidth -
					document.documentElement.clientWidth,
			);
			expect(
				overflow,
				`${lore.name} @ ${viewport.label}: horizontal overflow`,
			).toBeLessThanOrEqual(1);
		}
	}
});

test("reduced motion keeps the D/Yllith mode round-trip functional", async ({
	page,
}, testInfo) => {
	test.skip(testInfo.project.name !== "desktop-1080p");
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.setViewportSize({ width: 390, height: 844 });

	for (const lore of cases) {
		await roundTrip(page, lore, `${lore.name} reduced-motion`);
		const motion = await page.evaluate(() => ({
			scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
			viewTransition:
				typeof document.startViewTransition === "function"
					? "available-but-bypassed-by-contract"
					: "unavailable",
		}));
		expect(motion.scrollBehavior).toBe("auto");
	}
});

test("keyboard can switch both modes while preserving switch focus and state", async ({
	page,
}, testInfo) => {
	test.skip(testInfo.project.name !== "desktop-1080p");
	await page.setViewportSize({ width: 1366, height: 768 });

	for (const lore of cases) {
		await page.goto(lore.route, { waitUntil: "domcontentloaded" });
		const toggle = page.locator(lore.toggle);
		await toggle.focus();
		await toggle.press("Enter");
		await expectModeSemantics(toggle, true);
		await expect(page.locator("#reading-view")).toBeVisible();
		await expect(toggle).toBeFocused();

		await toggle.press("Space");
		await expectModeSemantics(toggle, false);
		await expect(toggle).toBeFocused();
	}
});

test("mobile touch can switch modes and the switch retains an accessible state", async ({
	browser,
}, testInfo) => {
	test.skip(testInfo.project.name !== "desktop-1080p", "real touch context runs once");
	const context = await browser.newContext({
		baseURL: "http://127.0.0.1:3101",
		viewport: { width: 390, height: 844 },
		hasTouch: true,
		isMobile: true,
	});
	const touchPage = await context.newPage();
	try {
		for (const lore of cases) {
			await touchPage.goto(lore.route, { waitUntil: "domcontentloaded" });
			const toggle = touchPage.locator(lore.toggle);
			await expectModeSemantics(toggle, false);
			await toggle.tap();
			await expectModeSemantics(toggle, true);
			await expect(touchPage.locator("#reading-view")).toBeVisible();
			await expect(toggle).toBeFocused();
		}
	} finally {
		await context.close();
	}
});

test("same-origin catalogue query context survives the standalone lore round trip", async ({
	page,
}, testInfo) => {
	test.skip(testInfo.project.name !== "desktop-1080p");

	for (const lore of cases) {
		await page.goto("/lore?campaign=passos-retomados", {
			waitUntil: "domcontentloaded",
		});
		await page.evaluate((route) => {
			const link = document.createElement("a");
			link.id = "continuity-fixture-link";
			link.href = route;
			link.textContent = "Abrir lore";
			document.body.append(link);
		}, lore.route);
		await page.locator("#continuity-fixture-link").click();
		await expect(page).toHaveURL(new RegExp(`${lore.route}$`, "u"));
		await expect(page.locator('a.tda-return[href^="/lore"]')).toHaveAttribute(
			"href",
			"/lore?campaign=passos-retomados",
		);
	}

	await page.goto("/lore/d", { waitUntil: "domcontentloaded" });
	await expect(page.locator("a.tda-return")).toHaveAttribute("href", "/lore");
});
