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

const browser = await chromium.launch({ headless: true });

try {
	const context = await browser.newContext();
	const page = await context.newPage();

	await page.goto(productionOrigin, {
		waitUntil: "domcontentloaded",
		timeout: 60_000,
	});

	const responsePromises = assets.map((asset) =>
		page
			.waitForResponse((response) => response.url() === asset.publicUrl, {
				timeout: 15_000,
			})
			.then(async (response) => {
				const body = Buffer.from(await response.body());
				return {
					status: response.status(),
					contentType:
						response.headers()["content-type"]?.split(";")[0]?.trim() ?? null,
					bytes: body.length,
					sha256: sha256(body),
				};
			})
			.catch(() => null),
	);

	const imageResultsPromise = page.evaluate((urls) => {
		return Promise.all(
			urls.map(
				(url) =>
					new Promise((resolve) => {
						const image = new Image();
						let settled = false;
						const finish = (loaded) => {
							if (settled) return;
							settled = true;
							resolve({
								url,
								loaded,
								naturalWidth: image.naturalWidth,
								naturalHeight: image.naturalHeight,
							});
						};
						const timer = window.setTimeout(() => finish(false), 15_000);
						image.alt = "";
						image.style.position = "fixed";
						image.style.width = "1px";
						image.style.height = "1px";
						image.style.opacity = "0";
						image.onload = () => {
							window.clearTimeout(timer);
							finish(true);
						};
						image.onerror = () => {
							window.clearTimeout(timer);
							finish(false);
						};
						document.body.append(image);
						image.src = url;
					}),
			),
		);
	}, assets.map((asset) => asset.publicUrl));

	const [responses, imageResults] = await Promise.all([
		Promise.all(responsePromises),
		imageResultsPromise,
	]);

	for (let index = 0; index < assets.length; index += 1) {
		const asset = assets[index];
		const response = responses[index];
		const image = imageResults[index];

		if (
			response?.status !== 200 ||
			response.contentType !== asset.contentType ||
			response.bytes !== asset.bytes ||
			response.sha256 !== asset.sha256 ||
			image?.loaded !== true ||
			image.naturalWidth <= 0 ||
			image.naturalHeight <= 0
		) {
			throw new Error(
				`browser image verification failed for ${asset.file}: ` +
					`status=${response?.status ?? "unavailable"} ` +
					`contentType=${response?.contentType ?? "unavailable"} ` +
					`bytes=${response?.bytes ?? "unavailable"} ` +
					`loaded=${image?.loaded ?? "unavailable"}`,
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
