import { expect, test } from "@playwright/test";
import { fixtureJob, installCompanionFixture } from "./companion-fixture";

for (const viewport of [
	{ width: 1440, height: 700 },
	{ width: 1024, height: 768 },
	{ width: 512, height: 384 },
	{ width: 320, height: 640 },
]) {
	test(`last-row actions remain reachable at ${viewport.width}x${viewport.height}`, async ({
		page,
	}, testInfo) => {
		await page.setViewportSize(viewport);
		await installCompanionFixture(page, {
			profileReady: true,
			advanceJobs: false,
			initialJobs: Array.from({ length: 30 }, (_, index) =>
				fixtureJob("cancelled", {
					id: `job-${String(index).padStart(2, "0")}`,
					context: {
						campaign_id: "synthetic",
						session_id: `session-${index}`,
						source_id: `source-${index}`,
						profile_id: "qwen-quality",
					},
				}),
			),
		});
		await page.goto("/");
		await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
		await page.getByRole("tab", { name: "Fila", exact: true }).click();
		await page.getByRole("button", { name: "Cancelados", exact: true }).click();
		const queue = page.locator("[data-processing-queue='true']");
		const frame = queue.locator("table").locator("..");
		const last = queue.getByRole("button", { name: /Mais ações para/ }).last();
		await last.scrollIntoViewIfNeeded();
		if (viewport.width > 900) {
			expect(
				await frame.evaluate(
					(element) => element.scrollHeight > element.clientHeight,
				),
			).toBe(true);
			await frame.evaluate((element) => {
				element.scrollTop = element.scrollHeight;
			});
		}
		await last.click();
		const popup = page.locator("[data-queue-actions='true']");
		await expect(popup).toBeVisible();
		await expect(last).toHaveAttribute("aria-expanded", "true");
		await expect(
			popup.getByRole("button", { name: "Detalhes", exact: true }),
		).toBeFocused();
		const box = await popup.boundingBox();
		expect(box).not.toBeNull();
		if (!box) throw new Error("No popup bounds");
		expect(box.x).toBeGreaterThanOrEqual(7);
		expect(box.y).toBeGreaterThanOrEqual(7);
		expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 7);
		expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 7);
		// Hit testing proves the menu is not clipped or behind the sticky header.
		expect(
			await popup.evaluate((element) => {
				const bounds = element.getBoundingClientRect();
				return [bounds.top + 4, bounds.bottom - 4].every((y) =>
					element.contains(document.elementFromPoint(bounds.left + 20, y)),
				);
			}),
		).toBe(true);
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth,
			),
		).toBe(true);
		await page.screenshot({
			path: testInfo.outputPath(`queue-actions-${viewport.width}.png`),
		});
		await page.keyboard.press("Escape");
		await expect(popup).toHaveCount(0);
		await expect(last).toBeFocused();
		await page.keyboard.press("Enter");
		await expect(popup).toBeVisible();
		await page.keyboard.press("Shift+Tab");
		await expect(popup).toHaveCount(0);
		await expect(last).toBeFocused();
		await page.keyboard.press("Enter");
		await popup.getByRole("button", { name: "Excluir", exact: true }).focus();
		await page.keyboard.press("Tab");
		await expect(popup).toHaveCount(0);
		expect(
			await page.evaluate(() => document.activeElement !== document.body),
		).toBe(true);
		await last.click();
		await expect(popup).toBeVisible();
		if (viewport.width > 900)
			await frame.evaluate((element) => {
				element.scrollTop -= 20;
			});
		else await page.evaluate(() => window.scrollBy(0, -20));
		await expect(popup).toHaveCount(0);
		await last.click();
		await expect(popup).toBeVisible();
		await page.setViewportSize({ ...viewport, height: viewport.height - 10 });
		await expect(popup).toHaveCount(0);
	});
}

test("outside focus and filter changes dismiss the only actions popup", async ({
	page,
}) => {
	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: [
			fixtureJob("running"),
			fixtureJob("queued", { id: "second" }),
		],
	});
	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "Fila", exact: true }).click();
	const buttons = page.getByRole("button", { name: /Mais ações para/ });
	const popup = page.locator("[data-queue-actions='true']");
	await buttons.first().click();
	await buttons.last().focus();
	await page.keyboard.press("Enter");
	await expect(popup).toHaveCount(1);
	await expect(buttons.first()).toHaveAttribute("aria-expanded", "false");
	await page.getByRole("searchbox", { name: "Buscar" }).focus();
	await expect(popup).toHaveCount(0);
	await buttons.last().click();
	await page.getByRole("button", { name: "Cancelados", exact: true }).click();
	await expect(popup).toHaveCount(0);
	await expect(
		page.getByText("Nenhum trabalho neste recorte.", { exact: true }),
	).toBeVisible();
});
