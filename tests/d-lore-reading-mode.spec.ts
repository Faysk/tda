import { expect, test } from "@playwright/test";

test("D switches between cinematic and full reading modes on the same URL", async ({ page, request }) => {
	test.setTimeout(120000);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));

	for (let part = 1; part <= 4; part += 1) {
		const response = await request.get(`/lore/d/historia-${part}.md`);
		expect(response.ok()).toBe(true);
		expect((await response.text()).length).toBeGreaterThan(1000);
	}

	await page.goto("/lore/d");
	const initialUrl = page.url();
	const toggle = page.locator("#lore-mode-toggle");
	await expect(toggle).toBeVisible();
	await expect(toggle).toHaveAttribute("aria-checked", "false");
	await expect(page.locator('[data-lore-view="cinematic"]')).toBeVisible();

	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-checked", "true");
	await expect(page.locator("#reading-view")).toBeVisible();
	await expect(page.locator('[data-lore-view="cinematic"]')).toBeHidden();
	await expect(page.locator("[data-reading-chapter]")).toHaveCount(20);
	await expect(page.locator("#read-prologue h2")).toContainText("Sempre há um antes");
	await expect(page.locator("#read-epilogue h2")).toContainText("A resposta antes da pergunta");
	await expect(page.locator("#reading-progress-bar")).toBeAttached();
	expect(page.url()).toBe(initialUrl);

	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-checked", "false");
	await expect(page.locator('[data-lore-view="cinematic"]')).toBeVisible();
	await expect(page.locator("#reading-view")).toBeHidden();
	expect(page.url()).toBe(initialUrl);
	expect(errors).toEqual([]);
});

test("D reading mode exposes a compact chapter index on mobile", async ({ page, isMobile, viewport }) => {
	test.skip(!isMobile && (!viewport || viewport.width > 800), "mobile-only reading navigation check");
	await page.goto("/lore/d");
	await page.locator("#lore-mode-toggle").click();
	const mobileIndex = page.locator(".reading-mobile-toc");
	await expect(mobileIndex).toBeVisible();
	await mobileIndex.locator("summary").click();
	await expect(mobileIndex.locator('[data-reading-link="read-what-if"]')).toBeVisible();
});
