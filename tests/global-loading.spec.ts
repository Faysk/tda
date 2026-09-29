import { expect, test, type Page } from "@playwright/test";
import { TDA_BRAND_ASSETS } from "../src/config/brand-assets";

const overlay = '[data-global-loading="off"][aria-busy="true"][aria-label="Carregando"]';
const loaderLogo = `${overlay} [data-global-loading-logo="true"]`;

function isLoaderBrandAssetRequest(rawUrl: string): boolean {
	let decodedUrl = rawUrl;
	try {
		decodedUrl = decodeURIComponent(rawUrl);
	} catch {
		// Keep the original URL when it is not percent-encoded.
	}

	return (
		decodedUrl.includes(TDA_BRAND_ASSETS.markWhite) ||
		decodedUrl.includes("/brand/tda-mark-white.svg")
	);
}

function watchLoaderBrandAssetFailures(page: Page): string[] {
	const failures: string[] = [];

	page.on("response", (response) => {
		if (!isLoaderBrandAssetRequest(response.url())) return;
		if (response.status() >= 400) {
			failures.push(`HTTP ${response.status()} ${response.url()}`);
		}
	});

	page.on("requestfailed", (request) => {
		if (!isLoaderBrandAssetRequest(request.url())) return;
		failures.push(
			`REQUEST_FAILED ${request.url()} ${request.failure()?.errorText ?? "unknown"}`,
		);
	});

	return failures;
}

async function expectLoaderLogoLoaded(page: Page) {
	const logo = page.locator(loaderLogo);
	await expect(logo).toBeVisible();

	const state = await logo.evaluate(async (node) => {
		const image = node as HTMLImageElement;
		let decodeError: string | null = null;
		try {
			await image.decode();
		} catch (error) {
			decodeError = error instanceof Error ? error.message : String(error);
		}

		return {
			complete: image.complete,
			decodeError,
			naturalHeight: image.naturalHeight,
			naturalWidth: image.naturalWidth,
			src: image.currentSrc || image.src,
		};
	});

	expect(state.decodeError).toBeNull();
	expect(state.complete).toBe(true);
	expect(state.naturalWidth).toBeGreaterThan(0);
	expect(state.naturalHeight).toBeGreaterThan(0);
	expect(state.src).toBe(TDA_BRAND_ASSETS.markWhite);
}

async function startBlockingLoad(page: Page) {
	await page.evaluate(() => {
		const marker = document.createElement("div");
		marker.id = "global-loader-theme-marker";
		marker.setAttribute("aria-busy", "true");
		document.body.append(marker);
	});
	await expect(page.locator(overlay)).toBeVisible();
	await expectLoaderLogoLoaded(page);
}

async function stopBlockingLoad(page: Page) {
	await page.evaluate(() => {
		document.getElementById("global-loader-theme-marker")?.remove();
	});
	await expect(page.locator(overlay)).toHaveCount(0, { timeout: 2500 });
}

test("global loader follows blocking busy state without flashing for instant work", async ({
	page,
}) => {
	const assetFailures = watchLoaderBrandAssetFailures(page);
	await page.goto("/");

	await page.evaluate(() => {
		const marker = document.createElement("div");
		marker.id = "global-loader-test-marker";
		marker.setAttribute("aria-busy", "true");
		document.body.append(marker);
	});
	await expect(page.locator(overlay)).toBeVisible();
	await expectLoaderLogoLoaded(page);

	await page.evaluate(() => {
		document.getElementById("global-loader-test-marker")?.remove();
	});
	await expect(page.locator(overlay)).toHaveCount(0, { timeout: 2500 });

	await page.evaluate(() => {
		const marker = document.createElement("div");
		marker.id = "global-loader-fast-marker";
		marker.setAttribute("data-state", "saving");
		document.body.append(marker);
		window.setTimeout(() => marker.remove(), 25);
	});
	await page.waitForTimeout(220);
	await expect(page.locator(overlay)).toHaveCount(0);
	expect(assetFailures).toEqual([]);
});

test("global loader ignores explicitly background busy work", async ({ page }) => {
	await page.goto("/");

	await page.evaluate(() => {
		const background = document.createElement("div");
		background.id = "global-loader-background-marker";
		background.setAttribute("data-global-loading", "off");
		const busy = document.createElement("div");
		busy.setAttribute("aria-busy", "true");
		background.append(busy);
		document.body.append(background);
	});
	await page.waitForTimeout(220);
	await expect(page.locator(overlay)).toHaveCount(0);
});

test("global loader follows the active light and dark design-system theme", async ({ page }) => {
	const assetFailures = watchLoaderBrandAssetFailures(page);
	await page.goto("/");
	await page.evaluate(() => localStorage.setItem("tda-theme", "light"));
	await page.reload();
	await startBlockingLoad(page);

	const light = await page.locator(overlay).evaluate((element) => {
		const logo = element.querySelector("img");
		const style = getComputedStyle(element);
		return {
			backgroundImage: style.backgroundImage,
			backgroundColor: style.backgroundColor,
			filter: logo ? getComputedStyle(logo).filter : "missing",
		};
	});
	await stopBlockingLoad(page);

	await page.evaluate(() => localStorage.setItem("tda-theme", "dark"));
	await page.reload();
	await startBlockingLoad(page);

	const dark = await page.locator(overlay).evaluate((element) => {
		const logo = element.querySelector("img");
		const style = getComputedStyle(element);
		return {
			backgroundImage: style.backgroundImage,
			backgroundColor: style.backgroundColor,
			filter: logo ? getComputedStyle(logo).filter : "missing",
		};
	});

	expect(light.filter).not.toBe("none");
	expect(dark.filter).toBe("none");
	expect(light.backgroundColor).not.toBe(dark.backgroundColor);
	expect(light.backgroundImage).not.toBe(dark.backgroundImage);
	expect(assetFailures).toEqual([]);
});

test("global loader keeps the canonical decoded mark during a real route transition", async ({
	page,
}) => {
	const assetFailures = watchLoaderBrandAssetFailures(page);
	await page.goto("/e2e-fixtures/global-loading");

	const navigation = page.waitForURL(/\/e2e-fixtures\/global-loading\/slow$/u);
	await page.getByRole("link", { name: "Abrir rota lenta" }).click({
		noWaitAfter: true,
	});

	await expect(page.locator(overlay)).toBeVisible();
	await expectLoaderLogoLoaded(page);
	await navigation;
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"Global Loading E2E Target",
	);
	expect(assetFailures).toEqual([]);
});

test("global loader preserves the decoded mark with reduced motion", async ({ page }) => {
	const assetFailures = watchLoaderBrandAssetFailures(page);
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto("/");
	await startBlockingLoad(page);

	const motion = await page.locator(loaderLogo).evaluate((node) => {
		const spin = node.parentElement;
		return spin ? getComputedStyle(spin).animationName : "missing";
	});
	expect(motion).toBe("none");

	await stopBlockingLoad(page);
	expect(assetFailures).toEqual([]);
});
