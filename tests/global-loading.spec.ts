import { expect, test, type Page } from "@playwright/test";

const overlay = '[data-global-loading="off"][aria-busy="true"][aria-label="Carregando"]';

async function startBlockingLoad(page: Page) {
	await page.evaluate(() => {
		const marker = document.createElement("div");
		marker.id = "global-loader-theme-marker";
		marker.setAttribute("aria-busy", "true");
		document.body.append(marker);
	});
	await expect(page.locator(overlay)).toBeVisible();
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
	await page.goto("/");

	await page.evaluate(() => {
		const marker = document.createElement("div");
		marker.id = "global-loader-test-marker";
		marker.setAttribute("aria-busy", "true");
		document.body.append(marker);
	});
	await expect(page.locator(overlay)).toBeVisible();

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
});
