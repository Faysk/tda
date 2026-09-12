import { expect, test } from "@playwright/test";

test("D switches between cinematic and full reading modes on the same URL", async ({ page, request, isMobile, viewport }) => {
	test.setTimeout(120000);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));

	for (let part = 1; part <= 4; part += 1) {
		const response = await request.get(`/lore/d/historia-${part}.md`);
		expect(response.ok()).toBe(true);
		expect((await response.text()).length).toBeGreaterThan(1000);
	}

	await page.goto("/lore/d");
	const initialPath = new URL(page.url()).pathname;
	const favicon = page.locator('link[rel~="icon"][href$="favicon.svg"]');
	await expect(favicon).toHaveCount(1);
	await expect(favicon).toHaveAttribute("type", "image/svg+xml");
	expect(await favicon.evaluate((element: HTMLLinkElement) => new URL(element.href).pathname)).toBe("/lore/d/favicon.svg");
	const faviconResponse = await request.get("/lore/d/favicon.svg");
	expect(faviconResponse.ok()).toBe(true);
	expect(await faviconResponse.text()).toContain('aria-label="D."');

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
	expect(new URL(page.url()).pathname).toBe(initialPath);

	// Fragment navigation must stay inside the reading renderer. Because the
	// document has <base href="/lore/d/">, an unhandled #read-* link would
	// navigate to /lore/d/#... and reload back into Cinemático.
	await page.locator(".reading-start").click();
	await expect(toggle).toHaveAttribute("aria-checked", "true");
	await expect(page.locator("#reading-view")).toBeVisible();
	expect(new URL(page.url()).pathname).toBe(initialPath);
	expect(new URL(page.url()).hash).toBe("#read-prologue");

	const hasDesktopToc = !isMobile && (!viewport || viewport.width > 800);
	if (hasDesktopToc) {
		await page.locator('.reading-toc [data-reading-link="read-shot"]').click();
		await expect(toggle).toHaveAttribute("aria-checked", "true");
		await expect(page.locator("#reading-view")).toBeVisible();
		await expect(page.locator("#read-shot")).toBeInViewport();
		expect(new URL(page.url()).pathname).toBe(initialPath);
		expect(new URL(page.url()).hash).toBe("#read-shot");
	}

	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-checked", "false");
	await expect(page.locator('[data-lore-view="cinematic"]')).toBeVisible();
	await expect(page.locator("#reading-view")).toBeHidden();
	expect(new URL(page.url()).pathname).toBe(initialPath);
	expect(errors).toEqual([]);
});

test("D reading mode exposes a compact chapter index on mobile", async ({ page, isMobile, viewport }) => {
	test.skip(!isMobile && (!viewport || viewport.width > 800), "mobile-only reading navigation check");
	await page.goto("/lore/d");
	const initialPath = new URL(page.url()).pathname;
	const toggle = page.locator("#lore-mode-toggle");
	await toggle.click();
	const mobileIndex = page.locator(".reading-mobile-toc");
	await expect(mobileIndex).toBeVisible();
	await mobileIndex.locator("summary").click();
	const whatIfLink = mobileIndex.locator('[data-reading-link="read-what-if"]');
	await expect(whatIfLink).toBeVisible();
	await whatIfLink.click();
	await expect(toggle).toHaveAttribute("aria-checked", "true");
	await expect(page.locator("#reading-view")).toBeVisible();
	expect(new URL(page.url()).pathname).toBe(initialPath);
	expect(new URL(page.url()).hash).toBe("#read-what-if");
});
