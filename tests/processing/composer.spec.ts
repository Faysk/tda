import { expect, test } from "@playwright/test";
import { fixtureJob, installCompanionFixture } from "./companion-fixture";

async function openComposer(page: import("@playwright/test").Page) {
	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	const composer = page.locator("[data-craig-composer='true']");
	await expect(composer).toBeVisible();
	return composer;
}

async function chooseZip(
	composer: import("@playwright/test").Locator,
	name = "sessao-42.zip",
) {
	await composer.getByLabel("Export do Craig").setInputFiles({
		name,
		mimeType: "application/zip",
		buffer: Buffer.from("PK synthetic Craig fixture"),
	});
}

test("guided composer supports drag/drop, picker keyboard and progressive details", async ({
	page,
}) => {
	await installCompanionFixture(page, { profileReady: true });
	const composer = await openComposer(page);
	const dropzone = composer.locator("[data-craig-dropzone='true']");
	const dropTarget = composer.locator("[data-craig-drop-target='true']");

	await dropTarget.evaluate((element) => {
		const transfer = new DataTransfer();
		transfer.items.add(
			new File(["PK synthetic"], "Sessão épica #42.zip", {
				type: "application/zip",
			}),
		);
		element.dispatchEvent(
			new DragEvent("drop", {
				bubbles: true,
				cancelable: true,
				dataTransfer: transfer,
			}),
		);
	});

	await expect(dropzone).toHaveAttribute("data-selected", "true");
	await expect(composer.getByLabel("ID da sessão")).toHaveValue("Sessao-epica-42");
	await expect(composer).toContainText("Sessão épica #42.zip");
	await expect(composer).toContainText("Qwen3-ASR · pronto neste Companion");
	await expect(composer).toContainText("Ainda sem calibração nesta máquina.");
	await expect(composer.getByText(/Áudio permanece nesta máquina\./u)).toBeVisible();
	await expect(composer.getByLabel("Contexto opcional")).not.toBeVisible();

	const chooserPromise = page.waitForEvent("filechooser");
	await dropTarget.focus();
	await page.keyboard.press("Enter");
	const chooser = await chooserPromise;
	await chooser.setFiles({
		name: "sessao-42.zip",
		mimeType: "application/zip",
		buffer: Buffer.from("PK replacement"),
	});
	await expect(composer).toContainText("sessao-42.zip");
	await expect(composer.getByLabel("ID da sessão")).toHaveValue("Sessao-epica-42");

	await composer.getByText("Opções avançadas", { exact: true }).click();
	await expect(composer.getByLabel("Contexto opcional")).toBeVisible();
	await expect(composer.getByLabel("Glossário opcional")).toBeVisible();
});

test("composer state survives workspace tab switches without browser persistence", async ({
	page,
}) => {
	await installCompanionFixture(page, { profileReady: true });
	const composer = await openComposer(page);
	await chooseZip(composer);
	await composer.getByLabel("ID da sessão").fill("sessao-persistente");
	await composer.getByText("Opções avançadas", { exact: true }).click();
	await composer.getByLabel("Contexto opcional").fill("Contexto preservado");
	await composer.getByLabel("Glossário opcional").fill("Yuhara; Pipipi");

	await page.getByRole("tab", { name: "Fila" }).click();
	await page.getByRole("tab", { name: "Visão geral" }).click();

	await expect(composer).toContainText("sessao-42.zip");
	await expect(composer.getByLabel("ID da sessão")).toHaveValue("sessao-persistente");
	await expect(composer.getByLabel("Contexto opcional")).toHaveValue("Contexto preservado");
	await expect(composer.getByLabel("Glossário opcional")).toHaveValue("Yuhara; Pipipi");
	const storage = await page.evaluate(() => JSON.stringify(localStorage));
	expect(storage).not.toContain("tda.processing.lastSessionId");
});

test("local file validation blocks bad input before Companion upload", async ({ page }) => {
	const state = await installCompanionFixture(page, { profileReady: true });
	const composer = await openComposer(page);
	await composer.getByLabel("Export do Craig").setInputFiles({
		name: "audio.wav",
		mimeType: "audio/wav",
		buffer: Buffer.from("wav"),
	});
	await expect(composer.getByRole("alert")).toContainText("arquivo .zip exportado pelo Craig");
	expect(state.uploadCount).toBe(0);
	await expect(
		composer.getByRole("button", { name: "Adicionar à fila local", exact: true }),
	).toBeDisabled();
});

test("idle composer expands and running work switches it to compact mode", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	const state = await installCompanionFixture(page, { profileReady: true, advanceJobs: false });
	let composer = await openComposer(page);
	const overview = page.locator("[data-processing-overview-top='true']");
	await expect(overview).toHaveAttribute("data-mode", "idle");
	await expect(composer).toHaveAttribute("data-layout", "default");
	await expect(page.getByText("Processando agora", { exact: true })).not.toBeVisible();
	const idleBox = await composer.boundingBox();
	expect(idleBox?.width ?? 0).toBeGreaterThan(700);

	state.setJob(fixtureJob("running"));
	await page.reload();
	composer = await openComposer(page);
	await expect(overview).toHaveAttribute("data-mode", "running");
	await expect(composer).toHaveAttribute("data-layout", "compact");
	await expect(page.getByText("Processando agora", { exact: true })).toBeVisible();
});

test("mobile keeps file, session, profile, estimate, CTA and advanced controls in order", async ({
	page,
}) => {
	await page.setViewportSize({ width: 320, height: 780 });
	await installCompanionFixture(page, { profileReady: true });
	const composer = await openComposer(page);
	await chooseZip(composer);

	const locators = [
		composer.locator("[data-craig-dropzone='true']"),
		composer.getByLabel("ID da sessão"),
		composer.getByLabel("Perfil"),
		composer.getByText("Ainda sem calibração nesta máquina.", { exact: true }),
		composer.getByRole("button", { name: "Adicionar à fila local", exact: true }),
		composer.getByText("Opções avançadas", { exact: true }),
	];
	const boxes = await Promise.all(locators.map((locator) => locator.boundingBox()));
	expect(boxes.every(Boolean)).toBe(true);
	const ys = boxes.map((box) => box?.y ?? 0);
	for (let index = 1; index < ys.length; index += 1)
		expect(ys[index]).toBeGreaterThan(ys[index - 1]);

	expect(
		await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
	).toBe(true);
});
