import { expect, test } from "@playwright/test";
import {
	failedJob,
	fixtureJob,
	installCompanionFixture,
} from "../processing/companion-fixture";

const viewports = [
	{ name: "mobile-320", width: 320, height: 568 },
	{ name: "mobile-360", width: 360, height: 800 },
	{ name: "mobile-390", width: 390, height: 844 },
	{ name: "mobile-430", width: 430, height: 932 },
	{ name: "tablet-768", width: 768, height: 1024 },
	{ name: "tablet-820", width: 820, height: 1180 },
	{ name: "zoom-200-effective", width: 960, height: 540 },
	{ name: "notebook-1024", width: 1024, height: 768 },
	{ name: "notebook-1280-low", width: 1280, height: 720 },
	{ name: "notebook-1366", width: 1366, height: 768 },
	{ name: "desktop-1440", width: 1440, height: 900 },
	{ name: "full-hd", width: 1920, height: 1080 },
	{ name: "real-qhd-proxy", width: 2048, height: 1279 },
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
		system: {
			gpus: [
				{
					index: 0,
					name: "Synthetic GPU",
					utilizationPercent: 25,
					memoryUsedBytes: 4 * 1024 ** 3,
					memoryTotalBytes: 8 * 1024 ** 3,
				},
			],
		},
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
			page.getByText("Transcrever sessão", { exact: true }),
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
				page.getByRole("button", { name: "Atualizar estado", exact: true }),
			).toBeVisible();
			await expect(
				page.getByRole("button", { name: "Pausar novas execuções", exact: true }),
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
			const layoutMax = await workspace.evaluate(() =>
				Number.parseFloat(
					getComputedStyle(document.documentElement)
						.getPropertyValue("--ds-layout-max")
						.trim(),
				),
			);
			expect(layoutMax).toBeGreaterThan(0);
			expect(box?.width ?? 9999).toBeLessThanOrEqual(layoutMax + 1);
			// 4K must actually consume the configured layout budget instead of
			// regressing into a tiny centered desktop island.
			expect(box?.width ?? 0).toBeGreaterThanOrEqual(layoutMax - 2);
			const leftGap = box?.x ?? 0;
			const rightGap = viewport.width - ((box?.x ?? 0) + (box?.width ?? 0));
			expect(Math.abs(leftGap - rightGap)).toBeLessThanOrEqual(2);
		}
	});
}

test("healthy desktop command bar stays within the compact height budget", async ({ page }) => {
	await openRunningWorkspace(page, 1440, 900);
	const commandBar = page.locator("[data-processing-command-bar='true']");
	const box = await commandBar.boundingBox();
	expect(box).not.toBeNull();
	expect(box?.height ?? 999).toBeLessThanOrEqual(52);
	await expect(commandBar).toContainText("Synthetic GPU · 25% · 4.0/8.0 GB");
	await expect(commandBar).not.toContainText("Concluídos");
});

test("queue toolbar sticky offset clears the floating global chrome", async ({ page }) => {
	await openRunningWorkspace(page, 1366, 768);
	await page.getByRole("tab", { name: "Fila", exact: true }).click();

	const search = page.getByPlaceholder("Sessão, profile, source ou ID…");
	await expect(search).toBeVisible();
	const toolbar = search.locator("xpath=../..");
	expect(await toolbar.evaluate((element) => getComputedStyle(element).position)).toBe("sticky");

	const values = await page.evaluate(() => {
		const brand = document.querySelector<HTMLElement>(".brand")?.getBoundingClientRect();
		const trigger = document
			.querySelector<HTMLElement>(".account-menu-trigger")
			?.getBoundingClientRect();
		const toolbar = document
			.querySelector<HTMLInputElement>('input[placeholder="Sessão, profile, source ou ID…"]')
			?.parentElement?.parentElement;
		return {
			chromeBottom: Math.max(brand?.bottom ?? 0, trigger?.bottom ?? 0),
			stickyTop: toolbar ? Number.parseFloat(getComputedStyle(toolbar).top) : -1,
		};
	});
	expect(values.stickyTop).toBeGreaterThanOrEqual(values.chromeBottom + 4);
});

test("workspace tabs implement roving keyboard navigation", async ({ page }) => {
	await openRunningWorkspace(page, 1366, 768);
	const overview = page.getByRole("tab", { name: "Visão geral" });
	await overview.focus();

	await page.keyboard.press("ArrowRight");
	const queue = page.getByRole("tab", { name: "Fila" });
	await expect(queue).toBeFocused();
	await expect(queue).toHaveAttribute("aria-selected", "true");
	await expect(
		page
			.getByRole("tabpanel", { name: "Fila" })
			.locator('td[data-label="Estado"]')
			.getByText("Processando", { exact: true }),
	).toBeVisible();

	await page.keyboard.press("End");
	const diagnostics = page.getByRole("tab", { name: "Diagnóstico" });
	await expect(diagnostics).toBeFocused();
	await expect(diagnostics).toHaveAttribute("aria-selected", "true");
	expect(
		await page
			.getByRole("tablist", { name: "Áreas do processamento" })
			.evaluate((element) => element.scrollTop),
	).toBe(0);
	await expect(
		page.getByRole("heading", { name: "Detalhes do processamento" }),
	).toBeVisible();

	await page.keyboard.press("Home");
	await expect(overview).toBeFocused();
	await expect(overview).toHaveAttribute("aria-selected", "true");
});


test("processing UX v2 keeps the five first-class workspaces integrated", async ({ page }) => {
	await openRunningWorkspace(page, 1920, 1080);

	const tablist = page.getByRole("tablist", { name: "Áreas do processamento" });
	const tabs = tablist.getByRole("tab");
	await expect(tabs).toHaveCount(5);
	expect(await tabs.allTextContents()).toEqual([
		"Visão geral",
		"Fila",
		"Resultados",
		"Benchmark",
		"Diagnóstico",
	]);

	const expectedViews = [
		"Visão geral",
		"Fila",
		"Resultados",
		"Benchmark",
		"Diagnóstico",
	] as const;

	for (const label of expectedViews) {
		const tab = tablist.getByRole("tab", { name: label, exact: true });
		await tab.click();
		await expect(tab).toHaveAttribute("aria-selected", "true");
		await expect(page.getByRole("tabpanel", { name: label, exact: true })).toBeVisible();
	}

	// The epic explicitly retired the old Edit rail for Processing. Keep the
	// shell free of a direct navigation aside while the global TDA header stays
	// outside this component boundary.
	await expect(page.locator("[data-edit-shell='true'] > aside")).toHaveCount(0);

	const dimensions = await page.evaluate(() => ({
		scrollWidth: document.documentElement.scrollWidth,
		clientWidth: document.documentElement.clientWidth,
	}));
	expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
});

for (const theme of ["dark", "light"] as const) {
	test(`${theme} theme keeps WCAG operational contrast and layout intact`, async ({
		page,
	}) => {
		await page.addInitScript((value) => {
			document.documentElement.dataset.theme = value;
		}, theme);
		await openRunningWorkspace(page, 1440, 900);
		const values = await page.evaluate(() => {
			const resolveColor = (token: string) => {
				const probe = document.createElement("span");
				probe.style.color = `var(${token})`;
				document.body.append(probe);
				const color = getComputedStyle(probe).color;
				probe.remove();
				return color;
			};
			const luminance = (rgb: string) => {
				const components = (rgb.match(/[\d.]+/g) ?? [])
					.slice(0, 3)
					.map((value) => {
						const channel = Number(value) / 255;
						return channel <= 0.04045
							? channel / 12.92
							: ((channel + 0.055) / 1.055) ** 2.4;
					});
				return (
					(components[0] ?? 0) * 0.2126 +
					(components[1] ?? 0) * 0.7152 +
					(components[2] ?? 0) * 0.0722
				);
			};
			const contrast = (left: string, right: string) => {
				const a = luminance(left);
				const b = luminance(right);
				return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
			};
			const canvas = resolveColor("--ds-canvas");
			const surface = resolveColor("--ds-surface");
			const foreground = resolveColor("--ds-foreground");
			const muted = resolveColor("--ds-foreground-muted");
			const focus = resolveColor("--ds-control-focus-ring");
			return {
				foregroundContrast: contrast(foreground, canvas),
				mutedContrast: contrast(muted, canvas),
				focusContrast: contrast(focus, surface),
				scrollWidth: document.documentElement.scrollWidth,
				clientWidth: document.documentElement.clientWidth,
			};
		});
		expect(values.foregroundContrast).toBeGreaterThanOrEqual(4.5);
		expect(values.mutedContrast).toBeGreaterThanOrEqual(4.5);
		expect(values.focusContrast).toBeGreaterThanOrEqual(3);
		expect(values.scrollWidth).toBeLessThanOrEqual(values.clientWidth);
	});
}

for (const theme of ["dark", "light", "system-light"] as const) {
	test(`${theme}: warning uses its own accessible semantic color`, async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: theme === "dark" ? "dark" : "light", reducedMotion: "reduce" });
		await page.addInitScript((value) => {
			if (value !== "system-light") document.documentElement.dataset.theme = value;
		}, theme);
		await installCompanionFixture(page, { profileReady: true, advanceJobs: false,
			initialJobs: [fixtureJob("queued")], lifecycle: "paused" });
		await page.goto("/");
		const warning = page.getByText("Fila pausada", { exact: true });
		await expect(warning).toBeVisible();
		const colors = await page.locator("[data-processing-status-dot='true']").evaluate((element) => {
			const root = getComputedStyle(document.documentElement);
			const rgb = (token: string) => {
				const probe = document.createElement("span");
				probe.style.color = `var(${token})`;
				document.body.append(probe);
				const color = getComputedStyle(probe).color;
				probe.remove();
				return color;
			};
			return { dot: getComputedStyle(element).backgroundColor,
				warning: rgb("--ds-warning"), accent: rgb("--ds-accent-strong"),
				danger: rgb("--ds-danger"), success: rgb("--ds-success"),
				backgrounds: [rgb("--ds-canvas"), rgb("--ds-surface"), rgb("--ds-surface-elevated")],
				token: root.getPropertyValue("--ds-warning") };
		});
		expect(colors.token).not.toBe("");
		expect(colors.dot).toBe(colors.warning);
		for (const other of [colors.accent, colors.danger, colors.success]) expect(colors.warning).not.toBe(other);
		const luminance = (rgb: string) => {
			const components = (rgb.match(/[\d.]+/g) ?? []).slice(0, 3).map((value) => {
				const s = Number(value) / 255;
				return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
			});
			return components[0] * 0.2126 + components[1] * 0.7152 + components[2] * 0.0722;
		};
		for (const background of colors.backgrounds) {
			const a = luminance(colors.warning), b = luminance(background);
			expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(4.5);
		}
		await page.screenshot({ path: testInfo.outputPath(`warning-${theme}.png`), fullPage: true });
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
	const start = page.getByRole("button", { name: "Transcrever sessão" });
	await start.scrollIntoViewIfNeeded();
	await expect(start).toBeVisible();
	const overflow = await page.evaluate(() => ({
		html: getComputedStyle(document.documentElement).overflowY,
		body: getComputedStyle(document.body).overflowY,
	}));
	expect(overflow.html).not.toBe("hidden");
	expect(overflow.body).not.toBe("hidden");
});


test("operational grammar keeps state semantics distinct and essential text readable", async ({
	page,
}) => {
	await openRunningWorkspace(page, 1440, 900);

	const activeSurface = page.locator("article").first();
	const activeVisual = await activeSurface.evaluate((element) => {
		const style = getComputedStyle(element);
		return {
			boxShadow: style.boxShadow,
			borderLeftWidth: style.borderLeftWidth,
		};
	});
	expect(activeVisual.boxShadow).toBe("none");
	expect(activeVisual.borderLeftWidth).toBe("1px");

	const commandBar = page.locator("[data-processing-command-bar='true']");
	const operationalVisual = await commandBar.evaluate((element) => {
		const style = getComputedStyle(element);
		const counter = element.querySelector("[data-processing-counters='true'] span");
		return {
			borderTopWidth: style.borderTopWidth,
			borderBottomWidth: style.borderBottomWidth,
			fontFamily: style.fontFamily,
			counterFontSize: counter
				? Number.parseFloat(getComputedStyle(counter).fontSize)
				: 0,
		};
	});
	expect(operationalVisual.borderTopWidth).toBe("1px");
	expect(operationalVisual.borderBottomWidth).toBe("1px");
	expect(operationalVisual.counterFontSize).toBeGreaterThanOrEqual(11);
	expect(operationalVisual.fontFamily).toContain("sans-serif");

	await page.getByRole("tab", { name: "Diagnóstico" }).click();
	const logTime = page.getByRole("log").locator("time").first();
	await expect(logTime).toBeVisible();
	const logTimeSize = await logTime.evaluate((element) =>
		Number.parseFloat(getComputedStyle(element).fontSize),
	);
	expect(logTimeSize).toBeGreaterThanOrEqual(11);
});

test("queued and paused states do not masquerade as running or healthy", async ({ page }) => {
	await page.setViewportSize({ width: 1366, height: 768 });
	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: [fixtureJob("queued")],
		lifecycle: "paused",
	});
	await page.goto("/");

	const commandBar = page.locator("[data-processing-command-bar='true']");
	await expect(commandBar).toHaveAttribute("data-tone", "warning");
	await expect(page.getByText("Fila pausada", { exact: true })).toBeVisible();

	await page.getByRole("tab", { name: "Fila" }).click();
	const queued = page
		.getByRole("tabpanel", { name: "Fila" })
		.locator('td[data-label="Estado"]')
		.getByText("Na fila", { exact: true });
	await expect(queued).toBeVisible();
	await expect(queued).not.toHaveClass(/ds-status--accent/);
	await expect(queued).not.toHaveClass(/ds-status--danger/);
});


test("tab strip never owns vertical scrolling", async ({ page }) => {
	for (const viewport of [
		{ width: 320, height: 568 },
		{ width: 1920, height: 1080 },
		{ width: 2560, height: 1440 },
	]) {
		await openRunningWorkspace(page, viewport.width, viewport.height);
		const geometry = await page
			.getByRole("tablist", { name: "Áreas do processamento" })
			.evaluate((element) => {
				const style = getComputedStyle(element);
				return {
					overflowY: style.overflowY,
					clientHeight: element.clientHeight,
					scrollHeight: element.scrollHeight,
				};
			});
		expect(geometry.overflowY).toBe("hidden");
		expect(geometry.scrollHeight).toBeLessThanOrEqual(geometry.clientHeight + 1);
	}
});

test("desktop diagnostics gives the log its own scroll owner", async ({ page }) => {
	await openRunningWorkspace(page, 1920, 1080);
	await page.getByRole("tab", { name: "Diagnóstico" }).click();

	const log = page.getByRole("log");
	await expect(log).toBeVisible();
	const ownership = await log.evaluate((element) => {
		const style = getComputedStyle(element);
		const panel = element.closest("[role='tabpanel']");
		return {
			overflowY: style.overflowY,
			logHeight: element.getBoundingClientRect().height,
			viewportHeight: window.innerHeight,
			panelWidth: panel?.getBoundingClientRect().width ?? 0,
			logWidth: element.getBoundingClientRect().width,
		};
	});
	expect(["auto", "scroll"]).toContain(ownership.overflowY);
	expect(ownership.logHeight).toBeLessThan(ownership.viewportHeight);
	expect(ownership.logWidth).toBeGreaterThan(ownership.panelWidth * 0.5);
});


test("desktop diagnostics aligns the summary rail with the event explorer", async ({ page }) => {
	await openRunningWorkspace(page, 1920, 1080);
	await page.getByRole("tab", { name: "Diagnóstico" }).click();

	const core = page.locator("[data-diagnostics-core='true']");
	const summary = page.locator("[data-diagnostics-summary='true']");
	const events = page.locator("[data-diagnostics-events='true']");
	await expect(core).toBeVisible();
	await expect(summary).toBeVisible();
	await expect(events).toBeVisible();

	const geometry = await core.evaluate((element) => {
		const summaryRail = element.querySelector("[data-diagnostics-summary='true']");
		const eventPane = element.querySelector("[data-diagnostics-events='true']");
		const log = eventPane?.querySelector("[role='log']");
		if (!(summaryRail instanceof HTMLElement) || !(eventPane instanceof HTMLElement) || !(log instanceof HTMLElement)) {
			throw new Error("Diagnostics geometry targets are missing");
		}
		const coreBox = element.getBoundingClientRect();
		const summaryBox = summaryRail.getBoundingClientRect();
		const eventBox = eventPane.getBoundingClientRect();
		const logBox = log.getBoundingClientRect();
		return {
			display: getComputedStyle(element).display,
			topDelta: Math.abs(summaryBox.top - eventBox.top),
			summaryRight: summaryBox.right,
			eventLeft: eventBox.left,
			coreWidth: coreBox.width,
			logWidth: logBox.width,
			logBottom: logBox.bottom,
			viewportHeight: document.documentElement.clientHeight,
		};
	});

	expect(geometry.display).toBe("grid");
	expect(geometry.topDelta).toBeLessThanOrEqual(1);
	expect(geometry.eventLeft).toBeGreaterThan(geometry.summaryRight);
	expect(geometry.logWidth).toBeGreaterThan(geometry.coreWidth * 0.55);
	expect(geometry.logBottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
});

test("mobile diagnostics stacks summary and events without horizontal overflow", async ({ page }) => {
	await openRunningWorkspace(page, 390, 844);
	await page.getByRole("tab", { name: "Diagnóstico" }).click();

	const core = page.locator("[data-diagnostics-core='true']");
	const geometry = await core.evaluate((element) => {
		const summaryRail = element.querySelector("[data-diagnostics-summary='true']");
		const eventPane = element.querySelector("[data-diagnostics-events='true']");
		if (!(summaryRail instanceof HTMLElement) || !(eventPane instanceof HTMLElement)) {
			throw new Error("Diagnostics geometry targets are missing");
		}
		const summaryBox = summaryRail.getBoundingClientRect();
		const eventBox = eventPane.getBoundingClientRect();
		return {
			summaryTop: summaryBox.top,
			summaryBottom: summaryBox.bottom,
			eventTop: eventBox.top,
			scrollWidth: document.documentElement.scrollWidth,
			clientWidth: document.documentElement.clientWidth,
		};
	});

	expect(geometry.eventTop).toBeGreaterThanOrEqual(geometry.summaryBottom);
	expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
});

for (const viewport of [
	{ width: 1280, height: 720 },
	{ width: 1366, height: 768 },
]) {
	test(`${viewport.width}x${viewport.height} diagnostics falls back to document flow instead of clipping nested owners`, async ({
		page,
	}) => {
		await openRunningWorkspace(page, viewport.width, viewport.height);
		await page.getByRole("tab", { name: "Diagnóstico" }).click();

		const core = page.locator("[data-diagnostics-core='true']");
		const log = page.getByRole("log");
		await expect(log).toBeVisible();
		const state = await core.evaluate((element) => {
			const summary = element.querySelector("[data-diagnostics-summary='true']");
			const events = element.querySelector("[data-diagnostics-events='true']");
			if (!(summary instanceof HTMLElement) || !(events instanceof HTMLElement)) {
				throw new Error("Diagnostics regions are missing");
			}
			return {
				summaryBottom: summary.getBoundingClientRect().bottom,
				eventsTop: events.getBoundingClientRect().top,
				documentOverflow: getComputedStyle(document.documentElement).overflowY,
				bodyOverflow: getComputedStyle(document.body).overflowY,
				scrollWidth: document.documentElement.scrollWidth,
				clientWidth: document.documentElement.clientWidth,
			};
		});
		expect(state.eventsTop).toBeGreaterThanOrEqual(state.summaryBottom);
		expect(state.documentOverflow).not.toBe("hidden");
		expect(state.bodyOverflow).not.toBe("hidden");
		expect(state.scrollWidth).toBeLessThanOrEqual(state.clientWidth);
	});
}

test("QHD uses additional overview width without breaking the design-system max", async ({
	page,
}) => {
	await openRunningWorkspace(page, 2560, 1440);
	const workspace = page.locator("[data-processing-workspace='true']");
	const overview = page.getByRole("tabpanel", { name: "Visão geral" });
	const geometry = await overview.evaluate((element) => ({
		workspaceWidth: element.getBoundingClientRect().width,
	}));
	expect(geometry.workspaceWidth).toBeGreaterThan(1200);
	const workspaceBox = await workspace.boundingBox();
	expect(workspaceBox?.width ?? 9999).toBeLessThanOrEqual(2161);
});


test("queue last-row actions stay inside the viewport and restore focus", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1024, height: 768 });
	const jobs = Array.from({ length: 30 }, (_, index) =>
		fixtureJob("succeeded", {
			id: `job-done-${String(index).padStart(2, "0")}`,
			context: {
				campaign_id: "yuhara-main",
				session_id: `sessao-${String(index).padStart(2, "0")}`,
				source_id: `source-${String(index).padStart(2, "0")}`,
				profile_id: "whisper-turbo",
			},
			updated_at: `2026-09-25T10:${String(index).padStart(2, "0")}:00Z`,
		}),
	);
	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: jobs,
	});
	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "Fila" }).click();
	const queue = page.getByRole("tabpanel", { name: "Fila" });
	await queue.getByRole("button", { name: /Todos/ }).click();

	const trigger = queue.getByRole("button", {
		name: "Mais ações para sessao-00",
	});
	await trigger.scrollIntoViewIfNeeded();
	await trigger.click();

	const popup = page.locator("[data-queue-actions='true']");
	await expect(popup).toBeVisible();
	const box = await popup.boundingBox();
	expect(box).not.toBeNull();
	expect(box?.x ?? -1).toBeGreaterThanOrEqual(8);
	expect(box?.y ?? -1).toBeGreaterThanOrEqual(8);
	expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(1016);
	expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(760);

	await page.keyboard.press("Escape");
	await expect(popup).toHaveCount(0);
	await expect(trigger).toBeFocused();
});

test("queue overflow actions do not create horizontal overflow at 320px", async ({
	page,
}) => {
	await page.setViewportSize({ width: 320, height: 568 });
	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: [
			fixtureJob("succeeded", {
				id: "job-mobile-done",
				context: {
					campaign_id: "yuhara-main",
					session_id: "sessao-mobile-done",
					source_id: "source-mobile-done",
					profile_id: "whisper-turbo",
				},
			}),
		],
	});
	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "Fila" }).click();
	const queue = page.getByRole("tabpanel", { name: "Fila" });
	await queue.getByRole("button", { name: /Todos/ }).click();
	await queue
		.getByRole("button", { name: "Mais ações para sessao-mobile-done" })
		.click();
	const popup = page.locator("[data-queue-actions='true']");
	await expect(popup).toBeVisible();

	const geometry = await page.evaluate(() => ({
		scrollWidth: document.documentElement.scrollWidth,
		clientWidth: document.documentElement.clientWidth,
	}));
	expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
	const box = await popup.boundingBox();
	expect(box).not.toBeNull();
	expect(box?.x ?? -1).toBeGreaterThanOrEqual(8);
	expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(312);
});

for (const completedCount of [5, 20, 100] as const) {
	test(`completed queue keeps ${completedCount} terminal jobs dense and action-first`, async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width: 1920, height: 1080 });
		const jobs = Array.from({ length: completedCount }, (_, index) =>
			fixtureJob("succeeded", {
				id: `job-completed-${String(index).padStart(3, "0")}`,
				updated_at: `2026-09-28T18:${String(index % 60).padStart(2, "0")}:00Z`,
				context: {
					campaign_id: "yuhara-main",
					session_id: `sessao-completed-${String(index).padStart(3, "0")}`,
					source_id: `source-completed-${String(index).padStart(3, "0")}`,
					profile_id: index % 2 === 0 ? "qwen-quality" : "whisper-turbo",
				},
			}),
		);
		await installCompanionFixture(page, {
			profileReady: true,
			advanceJobs: false,
			initialJobs: jobs,
		});
		await page.goto("/");
		await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
		await page.getByRole("tab", { name: "Fila" }).click();
		const queue = page.getByRole("tabpanel", { name: "Fila" });
		await queue.getByRole("button", { name: /Concluídos/ }).click();

		const table = queue.locator("table[data-density='terminal']");
		await expect(table).toBeVisible();
		await expect(table.getByRole("columnheader", { name: "Conclusão" })).toBeVisible();
		await expect(table.getByRole("columnheader", { name: "Etapa / progresso" })).toHaveCount(0);
		await expect(table.getByRole("columnheader", { name: "Attempt" })).toHaveCount(0);
		await expect(table.getByRole("columnheader", { name: "Erro / recuperação" })).toHaveCount(0);
		await expect(queue.getByText("Resultado preparado", { exact: true })).toHaveCount(0);
		await expect(queue.getByText("100%", { exact: true })).toHaveCount(0);
		await expect(queue.getByRole("button", { name: "Abrir resultado" })).toHaveCount(completedCount);
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
		).toBeTruthy();

		await page.screenshot({
			path: testInfo.outputPath(`queue-completed-${completedCount}.png`),
			fullPage: false,
		});
	});
}

test("terminal failure keeps the warning factual without terminal-success noise", async ({
	page,
}, testInfo) => {
	await page.setViewportSize({ width: 1366, height: 768 });
	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: [failedJob({
			id: "job-terminal-warning",
			context: {
				campaign_id: "yuhara-main",
				session_id: "sessao-terminal-warning",
				source_id: "source-terminal-warning",
				profile_id: "qwen-quality",
			},
		})],
	});
	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "Fila" }).click();
	const queue = page.getByRole("tabpanel", { name: "Fila" });
	await queue.getByRole("button", { name: "Atenção", exact: true }).click();
	await expect(queue.getByText("Falhou", { exact: true })).toBeVisible();
	await expect(
		queue
			.locator('td[data-label="Estado"]')
			.getByText(/O alinhamento obrigatório falhou/u),
	).toBeVisible();
	await expect(queue.getByText("100%", { exact: true })).toHaveCount(0);
	await page.screenshot({
		path: testInfo.outputPath("queue-terminal-warning.png"),
		fullPage: false,
	});
});

test("diagnostics mode owns routine aggregation without a grouping preference", async ({
	page,
}, testInfo) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	const routineBefore = Array.from({ length: 50 }, (_, index) => ({
		seq: index + 1,
		at: `2026-09-28T12:00:${String(index).padStart(2, "0")}Z`,
		code: "QWEN_WINDOW_TRANSCRIBED",
		level: "info" as const,
		attempt: 1,
		data: { track: 1, speaker: "Synthetic", window: index + 1 },
	}));
	const warning = {
		seq: 51,
		at: "2026-09-28T12:00:51Z",
		code: "QWEN_ALIGNMENT_WINDOW_FAILED",
		level: "warning" as const,
		attempt: 1,
		data: { track: 1, speaker: "Synthetic", window: 51 },
	};
	const routineAfter = Array.from({ length: 49 }, (_, index) => ({
		seq: index + 52,
		at: `2026-09-28T12:01:${String(index).padStart(2, "0")}Z`,
		code: "QWEN_WINDOW_TRANSCRIBED",
		level: "info" as const,
		attempt: 1,
		data: { track: 1, speaker: "Synthetic", window: index + 52 },
	}));

	await page.setViewportSize({ width: 1920, height: 1080 });
	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: [fixtureJob("running")],
		jobEvents: [...routineBefore, warning, ...routineAfter],
	});
	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "Diagnóstico" }).click();

	const log = page.getByRole("log");
	await expect(
		page.getByRole("checkbox", { name: "Agrupar repetitivos" }),
	).toHaveCount(0);
	await expect(page.getByText("Agrupar repetitivos", { exact: true })).toHaveCount(0);

	// Humanizada owns presentation density: allowlisted routine success spam is
	// aggregated automatically while warnings remain factual and independently visible.
	await expect(
		page.getByRole("button", { name: "Humanizada", exact: true }),
	).toHaveAttribute("aria-pressed", "true");
	await expect(log.locator("button[data-event-seq]")).toHaveCount(3);
	await expect(log.locator('button[data-event-seq="51"]')).toHaveAttribute(
		"data-level",
		"warning",
	);
	await page.screenshot({
		path: testInfo.outputPath("diagnostics-humanized-100-events.png"),
		fullPage: false,
	});

	// Técnica is authoritative: every factual event remains individually available
	// in sequence; presentation grouping cannot hide the original event count.
	await page.getByRole("button", { name: "Técnica", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Técnica", exact: true }),
	).toHaveAttribute("aria-pressed", "true");
	await expect(log.locator("button[data-event-seq]")).toHaveCount(100);
	await expect(log.locator('button[data-event-seq="1"]')).toBeAttached();
	await expect(log.locator('button[data-event-seq="51"]')).toHaveAttribute(
		"data-level",
		"warning",
	);
	await expect(log.locator('button[data-event-seq="100"]')).toBeAttached();
	await page.screenshot({
		path: testInfo.outputPath("diagnostics-technical-100-events.png"),
		fullPage: false,
	});
});

test("retired grouping preference stays absent across responsive diagnostics", async ({
	page,
}) => {
	for (const viewport of [
		{ width: 320, height: 568 },
		{ width: 390, height: 844 },
		{ width: 960, height: 540 },
		{ width: 1366, height: 768 },
		{ width: 1920, height: 1080 },
		{ width: 2560, height: 1440 },
	]) {
		await openRunningWorkspace(page, viewport.width, viewport.height);
		await page.getByRole("tab", { name: "Diagnóstico" }).click();
		await expect(
			page.getByRole("checkbox", { name: "Agrupar repetitivos" }),
		).toHaveCount(0);
		await expect(page.getByText("Agrupar repetitivos", { exact: true })).toHaveCount(0);
		const horizontal = await page.evaluate(() => ({
			scrollWidth: document.documentElement.scrollWidth,
			clientWidth: document.documentElement.clientWidth,
		}));
		expect(horizontal.scrollWidth).toBeLessThanOrEqual(horizontal.clientWidth + 1);
	}
});

