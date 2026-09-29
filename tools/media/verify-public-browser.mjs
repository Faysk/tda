import { createHash } from "node:crypto";
import fs from "node:fs";
import { chromium } from "@playwright/test";

const receiptPath = process.argv[2];
if (!receiptPath) throw new Error("receipt path is required");

const productionOrigin = process.env.PRODUCTION_ORIGIN?.trim() || "https://dnd.faysk.dev";
const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
const assets = receipt.assets.filter((asset) => asset.publicDeliveryChallenge === true);

if (assets.length === 0) {
	console.log("MEDIA_BROWSER_VERIFY_SKIP no challenged assets");
	process.exit(0);
}

function sha256(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}

async function verifyAsProductImage(context, asset) {
	let last = null;

	for (let attempt = 1; attempt <= 3; attempt += 1) {
		const page = await context.newPage();
		try {
			await page.goto(productionOrigin, {
				waitUntil: "domcontentloaded",
				timeout: 60_000,
			});

			const responsePromise = page.waitForResponse(
				(response) => response.url() === asset.publicUrl,
				{ timeout: 45_000 },
			);

			const imagePromise = page.evaluate((url) => {
				return new Promise((resolve) => {
					const image = new Image();
					image.alt = "";
					image.style.position = "fixed";
					image.style.width = "1px";
					image.style.height = "1px";
					image.style.opacity = "0";
					image.onload = () =>
						resolve({
							loaded: true,
							naturalWidth: image.naturalWidth,
							naturalHeight: image.naturalHeight,
						});
					image.onerror = () =>
						resolve({
							loaded: false,
							naturalWidth: image.naturalWidth,
							naturalHeight: image.naturalHeight,
						});
					document.body.append(image);
					image.src = url;
				});
			}, asset.publicUrl);

			const response = await responsePromise;
			const image = await imagePromise;
			const body = Buffer.from(await response.body());
			const contentType =
				response.headers()["content-type"]?.split(";")[0]?.trim() ?? null;

			last = {
				status: response.status(),
				contentType,
				bytes: body.length,
				sha256: sha256(body),
				loaded: image.loaded === true,
				naturalWidth: image.naturalWidth,
				naturalHeight: image.naturalHeight,
			};

			if (
				last.status === 200 &&
				last.contentType === asset.contentType &&
				last.bytes === asset.bytes &&
				last.sha256 === asset.sha256 &&
				last.loaded &&
				last.naturalWidth > 0 &&
				last.naturalHeight > 0
			) {
				return last;
			}
		} catch {
			last = null;
		} finally {
			await page.close();
		}
	}

	return last;
}

const browser = await chromium.launch({ headless: true });

try {
	const context = await browser.newContext();
	for (const asset of assets) {
		const result = await verifyAsProductImage(context, asset);

		if (
			result?.status !== 200 ||
			result.contentType !== asset.contentType ||
			result.bytes !== asset.bytes ||
			result.sha256 !== asset.sha256 ||
			result.loaded !== true
		) {
			throw new Error(
				`browser image verification failed for ${asset.file}: ` +
					`status=${result?.status ?? "unavailable"} ` +
					`contentType=${result?.contentType ?? "unavailable"} ` +
					`bytes=${result?.bytes ?? "unavailable"} ` +
					`loaded=${result?.loaded ?? "unavailable"}`,
			);
		}

		asset.publicDeliveryVerified = true;
		asset.publicDeliveryVerificationMode = "browser-image";
		console.log(`MEDIA_BROWSER_VERIFIED ${asset.file}`);
	}
} finally {
	await browser.close();
}

receipt.summary.verified = receipt.assets.filter(
	(asset) => asset.publicDeliveryVerified === true,
).length;

fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(
	`MEDIA_BROWSER_VERIFY_OK challenged=${assets.length} verified=${receipt.summary.verified}/${receipt.summary.assets}`,
);
