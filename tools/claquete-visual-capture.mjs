import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const baseURL = "http://127.0.0.1:3101";
const output = "visual-qa";
await mkdir(output, { recursive: true });

const browser = await chromium.launch({ headless: true });

async function captureScene(page, id, filename) {
	await page.goto(`${baseURL}/lore/pipipi`, { waitUntil: "networkidle" });
	const scene = page.locator(`[data-scene="${id}"]`);
	await scene.evaluate((element) => {
		const rect = element.getBoundingClientRect();
		const absoluteTop = window.scrollY + rect.top;
		window.scrollTo(
			0,
			absoluteTop + Math.max(1, rect.height - window.innerHeight) * 0.5,
		);
	});
	await page.waitForTimeout(350);
	await page.screenshot({ path: `${output}/${filename}.png` });
}

async function captureSection(page, id, filename) {
	await page.goto(`${baseURL}/lore/pipipi`, { waitUntil: "networkidle" });
	const section = page.locator(`#${id}`);
	await section.evaluate((element) => {
		const rect = element.getBoundingClientRect();
		window.scrollTo(0, window.scrollY + rect.top - 120);
	});
	await page.waitForTimeout(250);
	await page.screenshot({ path: `${output}/${filename}.png` });
}

const mobile = await browser.newPage({ viewport: { width: 752, height: 1536 } });
await mobile.goto(`${baseURL}/lore/pipipi`, { waitUntil: "networkidle" });
await mobile.screenshot({ path: `${output}/mobile-hero-752x1536.png` });
for (const id of ["casa", "super-herois", "corredores", "cadeira", "ultimo-dia", "acordou"]) {
	await captureScene(mobile, id, `mobile-${id}-752x1536`);
}
await mobile.goto(`${baseURL}/lore`, { waitUntil: "networkidle" });
await mobile.screenshot({ path: `${output}/mobile-lore-index-752x1536.png` });
await mobile.close();

const desktop = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
for (const [id, name] of [
	["minha-mae-trabalhava-demais", "desktop-minha-mae-1920x1080"],
	["pipipi-e-dandelion", "desktop-pipipi-dandelion-1920x1080"],
	["a-pulseirinha", "desktop-pulseirinha-1920x1080"],
]) {
	await captureSection(desktop, id, name);
}
await captureScene(desktop, "super-herois", "desktop-super-herois-1920x1080");
await desktop.close();

await browser.close();
