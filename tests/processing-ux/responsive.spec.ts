import { expect, test } from "@playwright/test";
import {
	fixtureJob,
	installCompanionFixture,
} from "../processing/companion-fixture";

const viewports = [
	{ name: "mobile-320", width: 320, height: 568 },
	{ name: "mobile-390", width: 390, height: 844 },
	{ name: "tablet-768", width: 768, height: 1024 },
	{ name: "zoom-200-effective", width: 960, height: 540 },
	{ name: "notebook-1366", width: 1366, height: 768 },
	{ name: "full-hd", width: 1920, height: 1080 },
	{ name: "qhd", width: 2560, height: 1440 },
	{ name: "4k", width: 3840, height: 2160 },
] as const;

async function openRunningWorkspace(
	page: import("@playwright/test").Page,
	width: number,
	height: number,
) {
	await page.setViewportSize({ width, height });
	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: [fixtureJob("running")],
	});
	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await expect(
		page.getByRole("tab", { name: "Visão geral" }),
	).toHaveAttribute("aria-selected", "true");
}

for (const viewport of viewports) {
	test(`${viewport.name}: workspace reflows without page-level horizontal overflow`, async ({
		page,
	}) => {
		await openRunningWorkspace(page, viewport.width, viewport.height);

		const dimensions = await page.evaluate(() => ({
			scrollWidth: document.documentElement.scrollWidth,
			clientWidth: document.documentElement.clientWidth,
			bodyScrollWidth: document.body.scrollWidth,
		}));
		expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
		expect(dimensions.bodyScrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);

		await expect(page.getByText("Processando agora", { exact: true })).toBeVisible();
		await expect(
			page.getByText("Nova transcrição Craig", { exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Cancelar trabalho" }),
		).toBeVisible();

		const selectedTab = page.getByRole("tab", { name: "Visão geral" });
		const tabBox = await selectedTab.boundingBox();
		expect(tabBox?.height ?? 0).toBeGreaterThanOrEqual(40);

		if (viewport.name === "mobile-320") {
			const commandBar = page.locator("[data-processing-command-bar='true']");
			const barBox = await commandBar.boundingBox();
			expect(barBox).not.toBeNull();
			expect((barBox?.x ?? 0) + (barBox?.width ?? 0)).toBeLessThanOrEqual(
				viewport.width + 1,
			);
			await expect(
				page.getByRole("button", { name: "Pausar", exact: true }),
			).toBeVisible();
			await expect(
				page.getByRole("button", { name: "Diagnóstico", exact: true }),
			).toBeVisible();
		}

		if (viewport.name === "full-hd") {
			const vertical = await page.evaluate(() => ({
				scrollHeight: document.documentElement.scrollHeight,
				clientHeight: document.documentElement.clientHeight,
			}));
			expect(vertical.scrollHeight).toBeLessThanOrEqual(vertical.clientHeight + 1);
		}

		if (viewport.name === "4k") {
			const workspace = page.locator("[data-processing-workspace='true']");
			const box = await workspace.boundingBox();
			expect(box).not.toBeNull();
			expect(box?.width ?? 9999).toBeLessThanOrEqual(2161);
			const leftGap = box?.x ?? 0;
			const rightGap = viewport.width - ((box?.x ?? 0) + (box?.width ?? 0));
			expect(Math.abs(leftGap - rightGap)).toBeLessThanOrEqual(2);
		}
	});
}

test("workspace tabs implement roving keyboard navigation", async ({ page }) => {
	await openRunningWorkspace(page, 1366, 768);
	const overview = page.getByRole("tab", { name: "Visão geral" });
	await overview.focus();

	await page.keyboard.press("ArrowRight");
	const queue = page.getByRole("tab", { name: "Fila" });
	await expect(queue).toBeFocused();
	await expect(queue).toHaveAttribute("aria-selected", "true");
	await expect(page.getByRole("heading", { name: "Processando" })).toBeVisible();

	await page.keyboard.press("End");
	const diagnostics = page.getByRole("tab", { name: "Diagnóstico" });
	await expect(diagnostics).toBeFocused();
	await expect(diagnostics).toHaveAttribute("aria-selected", "true");
	await expect(
		page.getByRole("heading", { name: "Detalhes do processamento" }),
	).toBeVisible();

	await page.keyboard.press("Home");
	await expect(overview).toBeFocused();
	await expect(overview).toHaveAttribute("aria-selected", "true");
});

for (const theme of ["dark", "light"] as const) {
	test(`${theme} theme keeps operational contrast tokens and layout intact`, async ({
		page,
	}) => {
		await page.addInitScript((value) => {
			document.documentElement.dataset.theme = value;
		}, theme);
		await openRunningWorkspace(page, 1440, 900);
		const values = await page.evaluate(() => {
			const style = getComputedStyle(document.documentElement);
			return {
				canvas: style.getPropertyValue("--ds-canvas").trim(),
				foreground: style.getPropertyValue("--ds-foreground").trim(),
				scrollWidth: document.documentElement.scrollWidth,
				clientWidth: document.documentElement.clientWidth,
			};
		});
		expect(values.canvas).not.toBe("");
		expect(values.foreground).not.toBe("");
		expect(values.canvas).not.toBe(values.foreground);
		expect(values.scrollWidth).toBeLessThanOrEqual(values.clientWidth);
	});
}

test("reduced motion removes the tab indicator transition", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await openRunningWorkspace(page, 1440, 900);
	const duration = await page
		.getByRole("tab", { name: "Visão geral" })
		.evaluate((element) => getComputedStyle(element, "::after").transitionDuration);
	expect(duration.split(",").every((value) => value.trim() === "0s")).toBe(true);
});

test("low-height notebook keeps essential actions reachable instead of clipping", async ({
	page,
}) => {
	await openRunningWorkspace(page, 1024, 768);
	const add = page.getByRole("button", { name: "Adicionar à fila local" });
	await add.scrollIntoViewIfNeeded();
	await expect(add).toBeVisible();
	const overflow = await page.evaluate(() => ({
		html: getComputedStyle(document.documentElement).overflowY,
		body: getComputedStyle(document.body).overflowY,
	}));
	expect(overflow.html).not.toBe("hidden");
	expect(overflow.body).not.toBe("hidden");
});
