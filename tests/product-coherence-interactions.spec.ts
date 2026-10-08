import { writeFile } from "node:fs/promises";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { expectThemedSelectValue, selectThemedOption } from "./helpers/themed-select";

const CAMPAIGN_A = {
	route: "cronicas-da-mesa",
	technical: "yuhara-main",
	name: "Crônicas da Mesa",
} as const;

const CAMPAIGN_B = {
	route: "antes-que-seja-tarde",
	technical: "antes-que-seja-tarde",
	name: "Antes que seja tarde — uma campanha com nome deliberadamente comprido",
} as const;

const ALL_CAPABILITIES = [
	"campaign.transcript.read",
	"campaign.local.process",
	"campaign.world.layout.edit",
	"narrative.review.read",
	"campaign.permissions.manage",
] as const;

type MockCampaign = Readonly<{
	technicalSlug: string;
	routeKey: string;
	name: string;
	capabilities: readonly string[];
}>;

function campaign(
	value: typeof CAMPAIGN_A | typeof CAMPAIGN_B,
	capabilities: readonly string[] = ALL_CAPABILITIES,
): MockCampaign {
	return {
		technicalSlug: value.technical,
		routeKey: value.route,
		name: value.name,
		capabilities,
	};
}

async function mockAccess(
	page: Page,
	options: Readonly<{
		state?:
			| "anonymous"
			| "unavailable"
			| "authenticated_linked"
			| "authenticated_linked_no_grants";
		campaignsState?: "first_class" | "unavailable";
		campaigns?: readonly MockCampaign[];
	}> = {},
) {
	const state = options.state ?? "authenticated_linked";
	const authenticated =
		state === "authenticated_linked" ||
		state === "authenticated_linked_no_grants";
	const campaigns = (options.campaigns ?? []).map((item) => ({
		...item,
		lifecycle: "active" as const,
	}));

	await page.route("**/api/auth/me", async (route) => {
		await route.fulfill({
			status: state === "unavailable" ? 503 : 200,
			contentType: "application/json",
			body: JSON.stringify({
				state,
				scope: { type: "project", id: "tda" },
				...(authenticated
					? {
							identity: {
								displayName: "Acceptance sintético",
								avatarUrl: null,
							},
							capabilities: [],
							campaignsState: options.campaignsState ?? "first_class",
							campaigns,
						}
					: {
							campaignsState: state === "unavailable" ? "unavailable" : "none",
							campaigns: [],
						}),
			}),
		});
	});
}

async function openGlobalMenu(page: Page) {
	const trigger = page.getByRole("button", { name: "Abrir menu global" });
	await trigger.click();
	await expect(trigger).toHaveAttribute("aria-expanded", "true");
	const panel = page.getByRole("region", {
		name: "Navegação, conta e aparência",
	});
	await expect(panel).toBeVisible();
	return { trigger, panel };
}

function safeArtifactName(label: string) {
	return label
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/gu, "")
		.replace(/[^a-z0-9]+/giu, "-")
		.replace(/^-+|-+$/gu, "")
		.toLowerCase();
}

async function recordTargetGeometry(
	page: Page,
	locator: Locator,
	testInfo: TestInfo,
	label: string,
	minimum = { width: 32, height: 32 },
) {
	await locator.scrollIntoViewIfNeeded();
	await expect(locator, `${label}: target visible`).toBeVisible();
	const box = await locator.boundingBox();
	const viewport = page.viewportSize();

	expect(box, `${label}: bounding box available`).not.toBeNull();
	expect(viewport, `${label}: viewport available`).not.toBeNull();
	if (!box || !viewport) return;

	const measurement = {
		label,
		viewport,
		box,
		minimum,
		clipped: {
			left: box.x < 0,
			top: box.y < 0,
			right: box.x + box.width > viewport.width,
			bottom: box.y + box.height > viewport.height,
		},
	};

	const filename = `interaction-${safeArtifactName(label)}.json`;
	const path = testInfo.outputPath(filename);
	await writeFile(path, `${JSON.stringify(measurement, null, 2)}\n`, "utf8");
	await testInfo.attach(filename, { path, contentType: "application/json" });

	expect(box.x, `${label}: not clipped left`).toBeGreaterThanOrEqual(-1);
	expect(box.y, `${label}: not clipped top`).toBeGreaterThanOrEqual(-1);
	expect(
		box.x + box.width,
		`${label}: not clipped right`,
	).toBeLessThanOrEqual(viewport.width + 1);
	expect(
		box.y + box.height,
		`${label}: not clipped bottom`,
	).toBeLessThanOrEqual(viewport.height + 1);
	expect(box.width, `${label}: usable target width`).toBeGreaterThanOrEqual(
		minimum.width,
	);
	expect(box.height, `${label}: usable target height`).toBeGreaterThanOrEqual(
		minimum.height,
	);
}

async function captureInteraction(
	page: Page,
	testInfo: TestInfo,
	label: string,
) {
	const filename = `interaction-${safeArtifactName(label)}.png`;
	const path = testInfo.outputPath(filename);
	await page.screenshot({ path, fullPage: true });
	await testInfo.attach(filename, { path, contentType: "image/png" });
}

async function expectNoHorizontalOverflow(page: Page, label: string) {
	const overflow = await page.evaluate(
		() =>
			document.documentElement.scrollWidth -
			document.documentElement.clientWidth,
	);
	expect(overflow, `${label}: horizontal overflow`).toBeLessThanOrEqual(1);
}

test("[interaction] menu drilldown, campaign selection, navigation, Back and Escape preserve context and focus", async ({
	page,
}, testInfo) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await mockAccess(page, {
		campaigns: [campaign(CAMPAIGN_A), campaign(CAMPAIGN_B)],
	});
	await page.goto(`/campanhas/${CAMPAIGN_A.route}/sessoes`);

	let { trigger, panel } = await openGlobalMenu(page);
	await recordTargetGeometry(page, trigger, testInfo, "390-menu-trigger");

	const worldButton = panel.getByRole("button", { name: "Mundo" });
	await recordTargetGeometry(page, worldButton, testInfo, "390-world-drilldown");
	await worldButton.click();

	const backButton = panel.getByRole("button", { name: "Voltar para Explorar" });
	await expect(backButton).toBeFocused();
	await recordTargetGeometry(page, backButton, testInfo, "390-world-back");
	await captureInteraction(page, testInfo, "390-world-drilldown-open");

	await backButton.click();
	await expect(worldButton).toBeFocused();

	const selector = panel.getByLabel("Campanha das ferramentas");
	await expectThemedSelectValue(selector, CAMPAIGN_A.technical);
	await selectThemedOption(page, selector, CAMPAIGN_B.technical);
	await expectThemedSelectValue(selector, CAMPAIGN_B.technical);
	await expect(selector).toContainText(CAMPAIGN_B.name);
	await recordTargetGeometry(
		page,
		selector,
		testInfo,
		"390-long-campaign-selector",
		{ width: 44, height: 32 },
	);

	await expect(
		panel.getByRole("link", { name: "Transcrições", exact: true }),
	).toHaveAttribute("href", `/edit/${CAMPAIGN_B.technical}/transcricoes`);

	await panel.getByRole("link", { name: "Sessões", exact: true }).click();
	await expect(page).toHaveURL(/\/campanhas\/sessoes$/u);
	await page.goBack();
	await expect(page).toHaveURL(
		new RegExp(`/campanhas/${CAMPAIGN_A.route}/sessoes$`, "u"),
	);

	({ trigger, panel } = await openGlobalMenu(page));
	await expectThemedSelectValue(
		panel.getByLabel("Campanha das ferramentas"),
		CAMPAIGN_A.technical,
	);

	const lastControl = panel.getByRole("button", { name: "Sair" });
	await lastControl.scrollIntoViewIfNeeded();
	await lastControl.focus();
	await expect(lastControl).toBeFocused();
	await recordTargetGeometry(page, lastControl, testInfo, "390-last-control-sign-out");
	await captureInteraction(page, testInfo, "390-menu-context-restored");

	await page.keyboard.press("Escape");
	await expect(trigger).toHaveAttribute("aria-expanded", "false");
	await expect(trigger).toBeFocused();
});

test("[interaction] authenticated navigation distinguishes zero, one and many campaign contexts", async ({
	page,
}) => {
	await mockAccess(page, {
		state: "authenticated_linked_no_grants",
		campaigns: [],
	});
	await page.goto("/campanhas");
	let { panel } = await openGlobalMenu(page);
	await expect(panel.getByText("Ferramentas", { exact: true })).toHaveCount(0);
	await expect(panel.getByLabel("Campanha das ferramentas")).toHaveCount(0);

	await page.unroute("**/api/auth/me");
	await mockAccess(page, { campaigns: [campaign(CAMPAIGN_A)] });
	await page.reload();
	({ panel } = await openGlobalMenu(page));
	await expect(panel.getByText(CAMPAIGN_A.name, { exact: true })).toBeVisible();
	await expect(panel.getByLabel("Campanha das ferramentas")).toHaveCount(0);
	await expect(
		panel.getByRole("link", { name: "Transcrições", exact: true }),
	).toHaveAttribute("href", `/edit/${CAMPAIGN_A.route}/transcricoes`);

	await page.unroute("**/api/auth/me");
	await mockAccess(page, {
		campaigns: [campaign(CAMPAIGN_A), campaign(CAMPAIGN_B)],
	});
	await page.reload();
	({ panel } = await openGlobalMenu(page));
	const selector = panel.getByLabel("Campanha das ferramentas");
	await expect(selector).toBeVisible();
	await selector.click();
	const campaignListbox = page.getByRole("listbox", {
		name: "Campanha das ferramentas",
	});
	await expect(campaignListbox.getByRole("option")).toHaveCount(3);
	await expect(
		campaignListbox.getByRole("option", { name: CAMPAIGN_B.name, exact: true }),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(selector).toBeFocused();
	await expect(panel).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(panel).not.toBeVisible();
	await expect(page.getByRole("button", { name: "Abrir menu global", exact: true })).toBeFocused();
});

test("[interaction] 320/390/desktop/200%-proxy keep campaign controls reachable and unclipped", async ({
	page,
}, testInfo) => {
	await mockAccess(page, {
		campaigns: [campaign(CAMPAIGN_A), campaign(CAMPAIGN_B)],
	});

	for (const viewport of [
		{ width: 320, height: 720, label: "320x720" },
		{ width: 390, height: 844, label: "390x844" },
		{ width: 1366, height: 768, label: "1366x768" },
		{ width: 683, height: 384, label: "683x384-200-proxy" },
	] as const) {
		await page.setViewportSize(viewport);
		await page.goto(`/campanhas/${CAMPAIGN_A.route}/sessoes`);
		const { trigger, panel } = await openGlobalMenu(page);
		const selector = panel.getByLabel("Campanha das ferramentas");
		const signOut = panel.getByRole("button", { name: "Sair" });

		await recordTargetGeometry(
			page,
			trigger,
			testInfo,
			`${viewport.label}-menu-trigger`,
		);
		await recordTargetGeometry(
			page,
			selector,
			testInfo,
			`${viewport.label}-campaign-selector`,
			{ width: 44, height: 32 },
		);
		await recordTargetGeometry(
			page,
			signOut,
			testInfo,
			`${viewport.label}-last-control`,
		);
		await expectNoHorizontalOverflow(page, viewport.label);
		await captureInteraction(page, testInfo, `${viewport.label}-menu`);

		await page.keyboard.press("Escape");
		await expect(trigger).toBeFocused();
	}
});
