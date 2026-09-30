import { expect, test } from "@playwright/test";

const overlay =
	'[data-global-loading="off"][aria-busy="true"][aria-label="Carregando"]';

const responsiveViewports = [
	{ name: "mobile-min", width: 320, height: 800 },
	{ name: "mobile-target", width: 390, height: 844 },
	{ name: "laptop", width: 1366, height: 768 },
	{ name: "desktop", width: 1920, height: 1080 },
	{ name: "desktop-200-percent-equivalent", width: 960, height: 540 },
] as const;

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth + 1,
		),
	).toBe(true);
}

test("determinate progress exposes factual value and stays local", async ({ page }) => {
	await page.goto("/e2e-fixtures/progress-feedback");

	const wrapper = page
		.getByTestId("determinate-progress")
		.locator('[data-progress-mode="determinate"]');
	await expect(wrapper).toBeVisible();

	const progress = wrapper.locator("progress");
	await expect(progress).toHaveAttribute("max", "100");
	await expect(progress).toHaveAttribute("value", "42");
	await expect(progress).toHaveAttribute("aria-valuetext", "42 de 100 partes");
	await expect(page.locator(overlay)).toHaveCount(0);
});

test("indeterminate progress omits factual value instead of inventing a percentage", async ({
	page,
}) => {
	await page.goto("/e2e-fixtures/progress-feedback");

	const wrapper = page
		.getByTestId("indeterminate-progress")
		.locator('[data-progress-mode="indeterminate"]');
	await expect(wrapper).toBeVisible();

	const progress = wrapper.locator("progress");
	await expect(progress).toHaveAttribute("max", "100");
	await expect(progress).not.toHaveAttribute("value", /.+/u);
	await expect(progress).toHaveAttribute(
		"aria-valuetext",
		"Validando integridade",
	);
	await expect(page.locator(overlay)).toHaveCount(0);
});

test("indeterminate progress becomes static with reduced motion", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto("/e2e-fixtures/progress-feedback");

	const fill = page
		.getByTestId("indeterminate-progress")
		.locator('[data-progress-mode="indeterminate"] > span[aria-hidden="true"]');
	await expect(fill).toBeVisible();

	expect(await fill.evaluate((node) => getComputedStyle(node).animationName)).toBe(
		"none",
	);
});

test("accent progress remains factual and separate from estimate semantics", async ({
	page,
}) => {
	await page.goto("/e2e-fixtures/progress-feedback");

	const wrapper = page
		.getByTestId("accent-progress")
		.locator('[data-progress-mode="determinate"]');
	const progress = wrapper.locator("progress");

	await expect(progress).toHaveAttribute("value", "6");
	await expect(progress).toHaveAttribute("max", "10");
	await expect(progress).toHaveAttribute("aria-valuetext", "6 de 10 itens");
});


test("progress feedback stays legible across the canonical responsive matrix", async ({
	page,
}) => {
	test.setTimeout(45_000);

	for (const viewport of responsiveViewports) {
		await page.setViewportSize({ width: viewport.width, height: viewport.height });
		await page.goto("/e2e-fixtures/progress-feedback");

		for (const testId of [
			"determinate-progress",
			"indeterminate-progress",
			"accent-progress",
		]) {
			const region = page.getByTestId(testId);
			await expect(region).toBeVisible();
			const box = await region.boundingBox();
			expect(box, `${viewport.name} / ${testId}`).not.toBeNull();
			if (box) {
				expect(box.x, `${viewport.name} / ${testId}`).toBeGreaterThanOrEqual(-1);
				expect(
					box.x + box.width,
					`${viewport.name} / ${testId}`,
				).toBeLessThanOrEqual(viewport.width + 1);
			}
		}

		await expectNoHorizontalOverflow(page);
		await expect(page.locator(overlay)).toHaveCount(0);
	}
});

test("progress uses semantic theme roles in dark and light modes", async ({ page }) => {
	async function sample(theme: "dark" | "light") {
		await page.goto("/e2e-fixtures/progress-feedback");
		await page.evaluate((value) => localStorage.setItem("tda-theme", value), theme);
		await page.reload();

		const wrapper = page
			.getByTestId("determinate-progress")
			.locator('[data-progress-mode="determinate"]');
		await expect(wrapper).toBeVisible();
		const fill = wrapper.locator(':scope > span[aria-hidden="true"]');

		return {
			track: await wrapper.evaluate((node) => getComputedStyle(node).backgroundColor),
			fill: await fill.evaluate((node) => getComputedStyle(node).backgroundColor),
		};
	}

	const dark = await sample("dark");
	const light = await sample("light");

	expect(dark.track).not.toBe("rgba(0, 0, 0, 0)");
	expect(dark.fill).not.toBe("rgba(0, 0, 0, 0)");
	expect(light.track).not.toBe("rgba(0, 0, 0, 0)");
	expect(light.fill).not.toBe("rgba(0, 0, 0, 0)");
	expect(light.track).not.toBe(dark.track);
	expect(light.fill).not.toBe(dark.fill);
});
