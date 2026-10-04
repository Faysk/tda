import { expect, type Locator, type Page } from "@playwright/test";

export async function selectThemedOption(
	page: Page,
	trigger: Locator,
	value: string,
) {
	const label = await trigger.getAttribute("aria-label");
	if (!label) throw new Error("THEMED_SELECT_MISSING_ARIA_LABEL");
	await trigger.click();
	const listbox = page.getByRole("listbox", { name: label });
	await expect(listbox).toBeVisible();
	const options = listbox.getByRole("option");
	for (let index = 0; index < (await options.count()); index += 1) {
		const option = options.nth(index);
		if ((await option.getAttribute("data-value")) === value) {
			await option.click();
			await expect(trigger).toHaveAttribute("data-value", value);
			await expect(trigger).toHaveAttribute("aria-expanded", "false");
			return;
		}
	}
	throw new Error(`THEMED_SELECT_OPTION_NOT_FOUND:${label}:${value}`);
}

export async function expectThemedSelectValue(
	trigger: Locator,
	value: string,
) {
	await expect(trigger).toHaveAttribute("data-value", value);
}

export async function selectThemedOptionByLabel(
	page: Page,
	trigger: Locator,
	optionLabel: string,
) {
	const label = await trigger.getAttribute("aria-label");
	if (!label) throw new Error("THEMED_SELECT_MISSING_ARIA_LABEL");
	await trigger.click();
	const listbox = page.getByRole("listbox", { name: label });
	await expect(listbox).toBeVisible();
	const option = listbox.getByRole("option", { name: optionLabel, exact: true });
	await expect(option).toHaveCount(1);
	const value = await option.getAttribute("data-value");
	await option.click();
	if (value !== null) await expect(trigger).toHaveAttribute("data-value", value);
	await expect(trigger).toHaveAttribute("aria-expanded", "false");
}
