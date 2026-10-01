import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
	expect,
	test,
	type Page,
	type Response,
} from "@playwright/test";

const canonicalProductionOrigin = "https://dnd.faysk.dev";
const targetOrigin = process.env.TDA_CATALOGUE_ORIGIN?.replace(/\/$/, "") ?? "";

const pipipiManifest = JSON.parse(
	await readFile(new URL("../media/manifests/pipipi.json", import.meta.url), "utf8"),
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

const mediaOrigin = pipipiManifest.publicOrigin.replace(/\/$/, "");
const mediaNamespace = pipipiManifest.namespace.replace(/^\/+|\/+$/g, "");
const stageAsset =
	pipipiManifest.assets.find((asset) => asset.file === "stage-bg.avif") ??
	(() => {
		throw new Error(
			"stage-bg.avif is missing from the canonical Pipipi media manifest",
		);
	})();

const stageUrl = `${mediaOrigin}/${mediaNamespace}/${stageAsset.sha256}/${stageAsset.file}`;
const route = (pathname: string) =>
	targetOrigin ? `${targetOrigin}${pathname}` : pathname;

function sha256(bytes: Uint8Array) {
	return createHash("sha256").update(bytes).digest("hex");
}

async function verifyExactStageResponse(response: Response) {
	expect(response.status(), stageUrl).toBe(200);
	expect(
		response.headers()["content-type"]?.split(";")[0]?.trim(),
		stageUrl,
	).toBe(stageAsset.contentType);

	const body = Buffer.from(await response.body());
	expect(body.length, stageUrl).toBe(stageAsset.bytes);
	expect(sha256(body), stageUrl).toBe(stageAsset.sha256);
}

async function acquireCanonicalMediaClearance(page: Page) {
	const originResponse = await page.goto(canonicalProductionOrigin, {
		waitUntil: "domcontentloaded",
		timeout: 60_000,
	});
	expect(originResponse?.status(), canonicalProductionOrigin).toBe(200);

	const eventualSuccess = page
		.waitForResponse(
			(response) => response.url() === stageUrl && response.status() === 200,
			{ timeout: 60_000 },
		)
		.catch(() => null);

	const initialResponse = await page.goto(stageUrl, {
		waitUntil: "domcontentloaded",
		timeout: 60_000,
	});
	expect(initialResponse, "canonical media navigation returned no response").not.toBeNull();

	if (!initialResponse) {
		throw new Error("canonical media navigation returned no response");
	}

	if (initialResponse.status() === 200) {
		await verifyExactStageResponse(initialResponse);
		return;
	}

	expect(
		initialResponse.headers()["cf-mitigated"],
		`unexpected public-media failure: status=${initialResponse.status()} contentType=${
			initialResponse.headers()["content-type"] ?? "unavailable"
		}`,
	).toBe("challenge");

	const clearedResponse = await eventualSuccess;
	expect(
		clearedResponse,
		"Cloudflare challenge did not produce a 200 response for the canonical stage asset",
	).not.toBeNull();

	if (!clearedResponse) {
		throw new Error(
			"Cloudflare challenge did not produce a 200 response for the canonical stage asset",
		);
	}

	await verifyExactStageResponse(clearedResponse);
}

test("lore catalogue covers remain canonical, fetchable and decodable on mobile and desktop", async ({
	page,
}, testInfo) => {
	test.skip(
		testInfo.project.name !== "desktop-1080p",
		"catalogue media integrity uses one Chromium project with an explicit viewport matrix",
	);
	test.setTimeout(180_000);

	const cdp = await page.context().newCDPSession(page);
	await cdp.send("Network.enable");
	await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });

	await acquireCanonicalMediaClearance(page);

	for (const viewport of [
		{ label: "390x844", width: 390, height: 844 },
		{ label: "1920x1080", width: 1920, height: 1080 },
	] as const) {
		await page.setViewportSize({
			width: viewport.width,
			height: viewport.height,
		});

		const mediaResponses = new Map<string, Response>();
		const recordMediaResponse = (response: Response) => {
			if (response.url().startsWith(`${mediaOrigin}/`)) {
				mediaResponses.set(response.url(), response);
			}
		};
		page.on("response", recordMediaResponse);

		try {
			const response = await page.goto(route("/lore"), {
				waitUntil: "domcontentloaded",
				timeout: 60_000,
			});
			expect(response?.status(), `catalogue @ ${viewport.label}`).toBe(200);

			const cards = page.locator('section[aria-label="Lores publicadas"] article');
			const cardCount = await cards.count();
			expect(cardCount, `catalogue cards @ ${viewport.label}`).toBeGreaterThan(0);

			for (let index = 0; index < cardCount; index += 1) {
				const card = cards.nth(index);
				await card.scrollIntoViewIfNeeded();

				const image = card.locator("img").first();
				await expect(
					image,
					`catalogue image ${index} @ ${viewport.label}`,
				).toBeAttached();

				await expect
					.poll(
						() =>
							image.evaluate((node) => {
								const img = node as HTMLImageElement;
								return img.complete ? img.naturalWidth : 0;
							}),
						{
							timeout: 15_000,
							message: `catalogue image ${index} must decode @ ${viewport.label}`,
						},
					)
					.toBeGreaterThan(0);

				const assetUrl = await image.evaluate((node) => {
					const img = node as HTMLImageElement;
					return img.currentSrc || img.src;
				});

				expect(
					assetUrl,
					`catalogue image ${index} source @ ${viewport.label}`,
				).toMatch(/^https:\/\/media\.dnd\.faysk\.dev\//);

				await expect
					.poll(
						() => mediaResponses.get(assetUrl)?.status() ?? 0,
						{
							timeout: 15_000,
							message: `catalogue image ${index} GET @ ${viewport.label}`,
						},
					)
					.toBe(200);

				const networkResponse = mediaResponses.get(assetUrl);
				expect(
					networkResponse,
					`catalogue image ${index} network response @ ${viewport.label}`,
				).toBeDefined();

				if (!networkResponse) continue;

				expect(
					networkResponse.headers()["content-type"]?.split(";")[0]?.trim(),
					assetUrl,
				).toMatch(/^image\//);
			}

			const pipipiImage = page.locator('article[data-lore="pipipi"] img').first();
			await expect(pipipiImage).toBeAttached();

			const pipipiSource = await pipipiImage.evaluate((node) => {
				const img = node as HTMLImageElement;
				return img.currentSrc || img.src;
			});
			expect(pipipiSource).toBe(stageUrl);

			const pipipiResponse = mediaResponses.get(stageUrl);
			expect(
				pipipiResponse,
				`Pipipi stage network response @ ${viewport.label}`,
			).toBeDefined();
			if (pipipiResponse) {
				await verifyExactStageResponse(pipipiResponse);
			}

			await page.screenshot({
				path: testInfo.outputPath(
					`standalone-lore-catalogue-media-${viewport.label}.png`,
				),
				fullPage: false,
			});
		} finally {
			page.off("response", recordMediaResponse);
		}
	}
});
