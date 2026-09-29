import fs from "node:fs";
import { chromium } from "@playwright/test";

const receiptPath = process.argv[2];
if (!receiptPath) throw new Error("receipt path is required");

const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
const assets = receipt.assets.filter((asset) => asset.publicDeliveryChallenge === true);

if (assets.length === 0) {
	console.log("MEDIA_BROWSER_VERIFY_SKIP no challenged assets");
	process.exit(0);
}


const browser = await chromium.launch({ headless: true });

try {
	const context = await browser.newContext();
	for (const asset of assets) {
		const page = await context.newPage();
		let last = null;
		try {
			await page.goto(asset.publicUrl, {
				waitUntil: "domcontentloaded",
				timeout: 60_000,
			}).catch(() => undefined);

			const deadline = Date.now() + 45_000;
			while (Date.now() < deadline) {
				try {
					last = await page.evaluate(async (url) => {
						const response = await fetch(url, {
							cache: "no-store",
							credentials: "include",
						});
						const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() ?? null;
						const bytes = await response.arrayBuffer();
						const digest = await crypto.subtle.digest("SHA-256", bytes);
						return {
							status: response.status,
							contentType,
							bytes: bytes.byteLength,
							sha256: Array.from(new Uint8Array(digest), (byte) =>
								byte.toString(16).padStart(2, "0"),
							).join(""),
						};
					}, asset.publicUrl);
				} catch {
					last = null;
				}

				if (
					last?.status === 200 &&
					last.contentType === asset.contentType &&
					last.bytes === asset.bytes &&
					last.sha256 === asset.sha256
				) {
					asset.publicDeliveryVerified = true;
					asset.publicDeliveryVerificationMode = "browser";
					console.log(`MEDIA_BROWSER_VERIFIED ${asset.file}`);
					break;
				}

				await page.waitForTimeout(1_000);
			}

			if (asset.publicDeliveryVerified !== true) {
				throw new Error(
					`browser public verification failed for ${asset.file}: ` +
						`status=${last?.status ?? "unavailable"} ` +
						`contentType=${last?.contentType ?? "unavailable"} ` +
						`bytes=${last?.bytes ?? "unavailable"}`,
				);
			}
		} finally {
			await page.close();
		}
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
