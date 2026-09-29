import { createHash } from "node:crypto";
import fs from "node:fs";
import { chromium } from "@playwright/test";

const receiptPath = process.argv[2];
if (!receiptPath) throw new Error("receipt path is required");

const productionOrigin =
	process.env.PRODUCTION_ORIGIN?.trim() || "https://dnd.faysk.dev";
const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
const assets = receipt.assets.filter(
	(asset) => asset.publicDeliveryChallenge === true,
);

if (assets.length === 0) {
	console.log("MEDIA_BROWSER_VERIFY_SKIP no challenged assets");
	process.exit(0);
}

function sha256(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}

function responseMetadata(response) {
	return {
		status: response.status(),
		contentType:
			response.headers()["content-type"]?.split(";")[0]?.trim() ?? null,
		cfMitigated: response.headers()["cf-mitigated"] ?? null,
	};
}

async function readVerifiedResponse(response) {
	const metadata = responseMetadata(response);
	try {
		const body = Buffer.from(await response.body());
		return {
			...metadata,
			bytes: body.length,
			sha256: sha256(body),
			bodyReadable: true,
		};
	} catch (error) {
		return {
			...metadata,
			bytes: null,
			sha256: null,
			bodyReadable: false,
			bodyError: error instanceof Error ? error.message : String(error),
		};
	}
}

function responseMatchesAsset(result, asset) {
	return (
		result?.status === 200 &&
		result.contentType === asset.contentType &&
		result.bytes === asset.bytes &&
		result.sha256 === asset.sha256
	);
}

async function acquireMediaClearance(page, asset) {
	let last = null;
	const recordResponse = (response) => {
		if (response.url() === asset.publicUrl) {
			last = responseMetadata(response);
		}
	};
	page.on("response", recordResponse);

	const successfulResponse = page
		.waitForResponse(
			(response) =>
				response.url() === asset.publicUrl && response.status() === 200,
			{ timeout: 60_000 },
		)
		.catch(() => null);

	try {
		const initialResponse = await page.goto(asset.publicUrl, {
			waitUntil: "domcontentloaded",
			timeout: 60_000,
		});

		if (!initialResponse) {
			throw new Error("initial navigation returned no response");
		}

		last = responseMetadata(initialResponse);

		if (initialResponse.status() === 200) {
			const result = await readVerifiedResponse(initialResponse);
			if (!responseMatchesAsset(result, asset)) {
				throw new Error(
					`initial 200 response failed integrity: contentType=${
						result.contentType ?? "unavailable"
					} bytes=${result.bytes ?? "unavailable"} bodyReadable=${
						result.bodyReadable
					}`,
				);
			}
			console.log(
				`MEDIA_BROWSER_CLEARANCE_NOT_REQUIRED ${asset.file} status=200`,
			);
			return;
		}

		if (initialResponse.headers()["cf-mitigated"] !== "challenge") {
			throw new Error(
				`initial navigation failed without Cloudflare challenge: status=${initialResponse.status()} contentType=${
					last.contentType ?? "unavailable"
				}`,
			);
		}

		console.log(
			`MEDIA_BROWSER_CHALLENGE ${asset.file} status=${initialResponse.status()}`,
		);

		const clearedResponse = await successfulResponse;
		if (!clearedResponse) {
			throw new Error(
				"Cloudflare challenge did not produce a 200 response within 60s",
			);
		}

		const result = await readVerifiedResponse(clearedResponse);
		if (!responseMatchesAsset(result, asset)) {
			throw new Error(
				`post-challenge response failed integrity: contentType=${
					result.contentType ?? "unavailable"
				} bytes=${result.bytes ?? "unavailable"} bodyReadable=${
					result.bodyReadable
				}`,
			);
		}

		console.log(
			`MEDIA_BROWSER_CLEARANCE_OK ${asset.file} status=${result.status}`,
		);
	} catch (error) {
		throw new Error(
			`browser challenge bootstrap failed for ${asset.file}: ${error instanceof Error ? error.message : String(error)}; lastStatus=${
				last?.status ?? "unavailable"
			} lastContentType=${last?.contentType ?? "unavailable"} cfMitigated=${
				last?.cfMitigated ?? "unavailable"
			}`,
		);
	} finally {
		page.off("response", recordResponse);
	}
}

const browser = await chromium.launch({ headless: false });

try {
	const context = await browser.newContext({ serviceWorkers: "block" });
	const page = await context.newPage();
	const cdp = await context.newCDPSession(page);
	await cdp.send("Network.enable");
	await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });

	await page.goto(productionOrigin, {
		waitUntil: "domcontentloaded",
		timeout: 60_000,
	});

	await acquireMediaClearance(page, assets[0]);

	await page.goto(productionOrigin, {
		waitUntil: "domcontentloaded",
		timeout: 60_000,
	});

	const responsePromises = assets.map((asset) =>
		page
			.waitForResponse((response) => response.url() === asset.publicUrl, {
				timeout: 15_000,
			})
			.then((response) => readVerifiedResponse(response))
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
			!responseMatchesAsset(response, asset) ||
			image?.loaded !== true ||
			image.naturalWidth <= 0 ||
			image.naturalHeight <= 0
		) {
			throw new Error(
				`browser image verification failed for ${asset.file}: ` +
					`status=${response?.status ?? "unavailable"} ` +
					`contentType=${response?.contentType ?? "unavailable"} ` +
					`bytes=${response?.bytes ?? "unavailable"} ` +
					`bodyReadable=${response?.bodyReadable ?? "unavailable"} ` +
					`loaded=${image?.loaded ?? "unavailable"}`,
			);
		}

		asset.publicDeliveryVerified = true;
		asset.publicDeliveryVerificationMode = "headful-browser-image-after-clearance";
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
