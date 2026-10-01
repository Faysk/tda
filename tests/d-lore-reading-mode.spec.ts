import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const dUiManifest = JSON.parse(
	readFileSync(new URL("../media/manifests/d-ui.json", import.meta.url), "utf8"),
) as {
	publicOrigin: string;
	namespace: string;
	assets: Array<{ file: string; sha256: string }>;
};

const dFaviconAsset = dUiManifest.assets.find((asset) => asset.file === "favicon.svg");
if (!dFaviconAsset) throw new Error("D favicon manifest asset is missing");
const D_FAVICON_URL = `${dUiManifest.publicOrigin}/${dUiManifest.namespace}/${dFaviconAsset.sha256}/${dFaviconAsset.file}`;


const pipipiManifest = JSON.parse(
	readFileSync(new URL("../media/manifests/pipipi.json", import.meta.url), "utf8"),
) as {
	publicOrigin: string;
	namespace: string;
	assets: Array<{
		file: string;
		bytes: number;
		sha256: string;
		contentType: string;
	}>;
};

const pipipiStageAsset = pipipiManifest.assets.find(
	(asset) => asset.file === "stage-bg.avif",
);
if (!pipipiStageAsset) throw new Error("Pipipi stage background manifest asset is missing");
const PIPIPI_STAGE_URL = `${pipipiManifest.publicOrigin}/${pipipiManifest.namespace}/${pipipiStageAsset.sha256}/${pipipiStageAsset.file}`;

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
	const favicon = page.locator('link[rel~="icon"]');
	await expect(favicon).toHaveCount(1);
	await expect(favicon).toHaveAttribute("type", "image/svg+xml");
	await expect(favicon).toHaveAttribute("href", D_FAVICON_URL);

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


test("D reading mode strips overlapping HTML comment delimiters until stable", async ({ page }) => {
	await page.route("**/lore/d/historia-1.md", async (route) => {
		const response = await route.fetch();
		const markdown = await response.text();
		await route.fulfill({
			response,
			body: `${markdown}\n\n<<!---->!-->-->\n`,
		});
	});

	await page.goto("/lore/d");
	await page.locator("#lore-mode-toggle").click();
	const readingView = page.locator("#reading-view");
	await expect(readingView).toBeVisible();

	// A single comment-removal pass leaves "<!-->-->" behind. The parser must
	// repeat sanitization until stable so overlapping delimiters cannot leak.
	await expect(readingView).not.toContainText("<!-->-->");
});


test("lore catalogue loads every listed cover and keeps Pipipi on the canonical R2 object", async ({ page, request }) => {
	test.setTimeout(120000);
	await page.goto("/lore");

	for (const slug of ["astel", "noah", "pipipi"]) {
		const card = page.locator(`[data-lore="${slug}"]`);
		await expect(card).toHaveCount(1);
		await card.scrollIntoViewIfNeeded();

		const image = card.locator("img");
		await expect(image).toHaveCount(1);
		await expect
			.poll(
				() =>
					image.evaluate(
						(node) =>
							node instanceof HTMLImageElement &&
							node.complete &&
							node.naturalWidth > 0 &&
							node.naturalHeight > 0,
					),
				{ timeout: 30000 },
			)
			.toBe(true);

		const src = await image.getAttribute("src");
		expect(src).toBeTruthy();
		if (!src) throw new Error(`catalogue image src missing for ${slug}`);

		const response = await request.get(src);
		expect(response.status(), `${slug} cover GET ${src}`).toBe(200);
		expect(response.headers()["content-type"]?.split(";")[0]).toMatch(/^image\//);
	}

	const pipipiImage = page.locator('[data-lore="pipipi"] img');
	const pipipiSrc = await pipipiImage.getAttribute("src");
	expect(pipipiSrc).toBe(PIPIPI_STAGE_URL);
	expect(new URL(PIPIPI_STAGE_URL).origin).toBe("https://media.dnd.faysk.dev");

	const response = await request.get(PIPIPI_STAGE_URL);
	expect(response.status()).toBe(200);
	expect(response.headers()["content-type"]?.split(";")[0]).toBe(
		pipipiStageAsset.contentType,
	);
	const body = await response.body();
	expect(body.byteLength).toBe(pipipiStageAsset.bytes);
	expect(createHash("sha256").update(body).digest("hex")).toBe(
		pipipiStageAsset.sha256,
	);

	const rendered = await pipipiImage.evaluate((node) => ({
		complete: (node as HTMLImageElement).complete,
		naturalWidth: (node as HTMLImageElement).naturalWidth,
		naturalHeight: (node as HTMLImageElement).naturalHeight,
		objectFit: getComputedStyle(node).objectFit,
	}));
	expect(rendered.complete).toBe(true);
	expect(rendered.naturalWidth).toBeGreaterThan(0);
	expect(rendered.naturalHeight).toBeGreaterThan(0);
	expect(rendered.objectFit).toBe("cover");
});
