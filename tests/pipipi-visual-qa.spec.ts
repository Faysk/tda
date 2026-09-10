import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const captureEnabled = process.env.PIPIPI_CAPTURE_QA === "1";
const outputDirectory = path.resolve(".qa-artifacts/pipipi");

async function captureViewport(page: Page, name: string) {
	await mkdir(outputDirectory, { recursive: true });
	await page.screenshot({
		path: path.join(outputDirectory, name),
		animations: "disabled",
	});
}

test("captures Pipipi hero and cinematic checkpoints", async ({ page }, testInfo) => {
	test.skip(!captureEnabled, "visual QA capture runs only in the dedicated CI evidence step");

	await page.goto("/lore/pipipi");
	await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
	await captureViewport(page, `${testInfo.project.name}-01-hero.png`);

	const corredores = page.locator('[data-scene="corredores"]');
	await corredores.scrollIntoViewIfNeeded();
	await corredores.evaluate((element) => {
		const rect = element.getBoundingClientRect();
		const absoluteTop = window.scrollY + rect.top;
		window.scrollTo(
			0,
			absoluteTop + Math.max(1, rect.height - window.innerHeight) * 0.55,
		);
	});
	await expect
		.poll(async () =>
			Number.parseFloat(
				(await corredores.evaluate((element) =>
					element.style.getPropertyValue("--scene-progress"),
				)) || "0",
			),
		)
		.toBeGreaterThan(0.25);
	await captureViewport(page, `${testInfo.project.name}-02-corredores.png`);

	if (testInfo.project.name === "desktop-1080p") {
		const turningPoint = page.getByRole("heading", {
			name: "Pipipi não mentiu nenhuma vez.",
		});
		await turningPoint.scrollIntoViewIfNeeded();
		await captureViewport(page, `${testInfo.project.name}-03-turning-point.png`);

		const ghostArrival = page.getByRole("heading", {
			name: "Algumas coisas terminaram naquele quarto. Outras continuaram voando com ela.",
		});
		await ghostArrival.scrollIntoViewIfNeeded();
		await captureViewport(page, `${testInfo.project.name}-04-ghost-arrival.png`);

		await page.emulateMedia({ reducedMotion: "reduce" });
		await corredores.scrollIntoViewIfNeeded();
		await expect
			.poll(async () =>
				corredores.evaluate((element) =>
					element.style.getPropertyValue("--scene-progress"),
				),
			)
			.toBe("0");
		await captureViewport(page, `${testInfo.project.name}-05-reduced-motion.png`);
	}
});
