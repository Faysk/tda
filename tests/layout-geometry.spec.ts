import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

// #1081 is the canonical browser gate for shared keylines and corner clearance.

type LayoutFamily = "cinematic" | "editorial" | "workspace";
type LayoutRole = "reading" | "editorial" | "expansive";

type StructuralMeasurement = Readonly<{
	left: number;
	containerLeft: number;
	containerWidth: number;
	gutter: number;
}>;

const LEMBRA_SEARCH = "Buscar título, descrição, autor ou data...";

async function expectNoHorizontalOverflow(page: Page) {
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth + 1,
		),
	).toBeTruthy();
}

async function structuralMeasurement(
	target: Locator,
): Promise<StructuralMeasurement | null> {
	return target.evaluate((element) => {
		const rootStyle = getComputedStyle(document.documentElement);
		const gutter = Number.parseFloat(
			rootStyle.getPropertyValue("--ds-page-gutter"),
		);
		if (!Number.isFinite(gutter)) return null;

		let current: HTMLElement | null = element as HTMLElement;
		while (current && current !== document.body) {
			const style = getComputedStyle(current);
			const paddingLeft = Number.parseFloat(style.paddingLeft);
			const rect = current.getBoundingClientRect();
			if (
				rect.width >= 500 &&
				Number.isFinite(paddingLeft) &&
				Math.abs(paddingLeft - gutter) <= 1.5
			) {
				return {
					left: rect.left + paddingLeft,
					containerLeft: rect.left,
					containerWidth: rect.width,
					gutter,
				};
			}
			current = current.parentElement;
		}
		return null;
	});
}

async function measurePublicKeylines(page: Page) {
	const measurements: Record<string, StructuralMeasurement> = {};

	for (const surface of [
		{ name: "home", path: "/", target: () => page.locator("#home-title") },
		{
			name: "sessions",
			path: "/sessoes",
			target: () => page.locator("#archive-title"),
		},
		{
			name: "lembra",
			path: "/lembra",
			target: () => page.getByPlaceholder(LEMBRA_SEARCH),
		},
	]) {
		await page.goto(surface.path);
		await expect(surface.target()).toBeVisible();
		const measurement = await structuralMeasurement(surface.target());
		expect(measurement, `${surface.name} must expose a gutter-bound structural ancestor`).not.toBeNull();
		if (!measurement) continue;
		measurements[surface.name] = measurement;
		await expectNoHorizontalOverflow(page);
	}

	return measurements;
}

async function installReceiptOverlay(page: Page) {
	await page.evaluate(() => {
		document.querySelector("[data-layout-receipt-overlay]")?.remove();
		const rootStyle = getComputedStyle(document.documentElement);
		const gutter = Number.parseFloat(
			rootStyle.getPropertyValue("--ds-page-gutter"),
		);
		const layoutMax = Number.parseFloat(
			rootStyle.getPropertyValue("--ds-layout-max"),
		);
		const shellWidth = Math.min(window.innerWidth, layoutMax);
		const shellLeft = (window.innerWidth - shellWidth) / 2;
		const leftKeyline = shellLeft + gutter;
		const rightKeyline = window.innerWidth - shellLeft - gutter;

		const overlay = document.createElement("div");
		overlay.dataset.layoutReceiptOverlay = "true";
		overlay.setAttribute("aria-hidden", "true");
		Object.assign(overlay.style, {
			position: "fixed",
			inset: "0",
			zIndex: "2147483647",
			pointerEvents: "none",
			fontFamily: "ui-sans-serif, system-ui, sans-serif",
			fontSize: "11px",
			color: "#fffdf8",
		});

		const line = (x: number, label: string) => {
			const marker = document.createElement("div");
			Object.assign(marker.style, {
				position: "absolute",
				top: "0",
				bottom: "0",
				left: `${Math.round(x)}px`,
				width: "1px",
				background: "rgba(242, 200, 121, 0.9)",
				boxShadow: "0 0 0 1px rgba(10, 12, 15, 0.24)",
			});
			const badge = document.createElement("span");
			badge.textContent = label;
			Object.assign(badge.style, {
				position: "absolute",
				top: "82px",
				left: "4px",
				padding: "2px 5px",
				borderRadius: "4px",
				background: "rgba(10, 12, 15, 0.84)",
				color: "#f2c879",
				whiteSpace: "nowrap",
			});
			marker.append(badge);
			overlay.append(marker);
		};

		const rect = (selector: string, label: string) => {
			const target = document.querySelector<HTMLElement>(selector);
			if (!target) return;
			const box = target.getBoundingClientRect();
			const marker = document.createElement("div");
			Object.assign(marker.style, {
				position: "absolute",
				left: `${Math.round(box.left)}px`,
				top: `${Math.round(box.top)}px`,
				width: `${Math.round(box.width)}px`,
				height: `${Math.round(box.height)}px`,
				border: "1px dashed rgba(242, 200, 121, 0.95)",
				borderRadius: "6px",
			});
			const badge = document.createElement("span");
			badge.textContent = label;
			Object.assign(badge.style, {
				position: "absolute",
				top: "calc(100% + 4px)",
				left: "0",
				padding: "2px 5px",
				borderRadius: "4px",
				background: "rgba(10, 12, 15, 0.84)",
				color: "#f2c879",
				whiteSpace: "nowrap",
			});
			marker.append(badge);
			overlay.append(marker);
		};

		line(leftKeyline, "keyline");
		line(rightKeyline, "keyline");
		rect(".brand", "brand safe area");
		rect(".account-menu-trigger", "avatar safe area");
		document.body.append(overlay);
	});
}

async function captureReceipt(
	page: Page,
	testInfo: TestInfo,
	path: string,
	name: string,
) {
	await page.setViewportSize({ width: 1920, height: 1080 });
	await page.goto(path);
	await page.evaluate(async () => {
		await document.fonts.ready;
	});
	await installReceiptOverlay(page);
	await page.screenshot({
		path: testInfo.outputPath(`layout-keylines-${name}.png`),
		fullPage: false,
	});
}

test("canonical page-family and width-role declarations cover representative surfaces", async ({
	page,
}) => {
	const surfaces: ReadonlyArray<{
		path: string;
		family: LayoutFamily;
		role: LayoutRole;
	}> = [
		{ path: "/", family: "cinematic", role: "expansive" },
		{ path: "/sessoes", family: "editorial", role: "expansive" },
		{ path: "/lembra", family: "editorial", role: "expansive" },
		{ path: "/lore", family: "editorial", role: "expansive" },
		{ path: "/personagens", family: "editorial", role: "editorial" },
		{ path: "/diario", family: "editorial", role: "expansive" },
		{ path: "/mundo", family: "workspace", role: "expansive" },
		{
			path: "/e2e-fixtures/account-overview?state=linked",
			family: "editorial",
			role: "editorial",
		},
	];

	for (const surface of surfaces) {
		await page.goto(surface.path);
		const declaration = page
			.locator(
				`[data-layout-family="${surface.family}"][data-layout-role="${surface.role}"]`,
			)
			.first();
		await expect(
			declaration,
			`${surface.path} must declare ${surface.family}/${surface.role}`,
		).toBeVisible();
		await expectNoHorizontalOverflow(page);
	}

	await page.goto("/diario");
	await expect(page.locator('[data-layout-content-role="editorial"]')).toBeVisible();
});

test("Home, Sessions and Lembra share one structural keyline and use wide viewports", async ({
	page,
}) => {
	const byViewport: Record<number, Record<string, StructuralMeasurement>> = {};

	for (const width of [1920, 2560]) {
		await page.setViewportSize({ width, height: width === 1920 ? 1080 : 1440 });
		byViewport[width] = await measurePublicKeylines(page);

		const lefts = Object.values(byViewport[width]).map((item) => item.left);
		expect(Math.max(...lefts) - Math.min(...lefts)).toBeLessThanOrEqual(2);
	}

	for (const surface of ["home", "sessions", "lembra"]) {
		expect(byViewport[2560][surface].containerWidth).toBeGreaterThan(
			byViewport[1920][surface].containerWidth + 150,
		);
		expect(byViewport[2560][surface].containerWidth).toBeLessThanOrEqual(2161);
	}
});

test("corner chrome never becomes a full-width spacer on representative surfaces", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1366, height: 768 });
	for (const path of ["/", "/sessoes", "/lembra", "/mundo"]) {
		await page.goto(path);
		const geometry = await page.evaluate(() => {
			const header = document.querySelector<HTMLElement>(".site-header");
			const brand = document.querySelector<HTMLElement>(".brand");
			const avatar = document.querySelector<HTMLElement>(".account-menu-trigger");
			if (!header || !brand || !avatar) return null;
			const headerStyle = getComputedStyle(header);
			return {
				headerHeight: Number.parseFloat(headerStyle.height),
				headerBackground: headerStyle.backgroundColor,
				brand: brand.getBoundingClientRect().toJSON(),
				avatar: avatar.getBoundingClientRect().toJSON(),
			};
		});
		expect(geometry).not.toBeNull();
		if (!geometry) continue;
		expect(geometry.headerHeight).toBeLessThanOrEqual(1);
		expect(geometry.headerBackground).toBe("rgba(0, 0, 0, 0)");
		expect(geometry.brand.left).toBeLessThan(140);
		expect(1366 - geometry.avatar.right).toBeLessThan(140);
		await expectNoHorizontalOverflow(page);
	}
});

test("geometry reflows at 320px, 390px and the 200% zoom proxy", async ({
	page,
}) => {
	for (const viewport of [
		{ width: 320, height: 800 },
		{ width: 390, height: 844 },
		{ width: 683, height: 384 },
	]) {
		await page.setViewportSize(viewport);
		for (const path of ["/", "/sessoes", "/lembra", "/mundo"]) {
			await page.goto(path);
			await expectNoHorizontalOverflow(page);
			const root = page.locator("[data-layout-family][data-layout-role]").first();
			await expect(root).toBeVisible();
		}
	}
});

test("visual receipts expose shared keylines and corner safe areas", async ({
	page,
}, testInfo) => {
	await captureReceipt(page, testInfo, "/", "home");
	await captureReceipt(page, testInfo, "/sessoes", "sessoes");
	await captureReceipt(page, testInfo, "/lembra", "lembra");
	await captureReceipt(page, testInfo, "/mundo", "workbench");
});
