import { expect, test } from "@playwright/test";

const overlay =
	'[data-global-loading="off"][aria-busy="true"][aria-label="Carregando"]';

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
