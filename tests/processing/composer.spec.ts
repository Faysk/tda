import { expect, test } from "@playwright/test";
import { installCompanionFixture } from "./companion-fixture";

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

test("dropzone aceita drag/drop e teclado, sugere sessão segura e mantém privacy visível", async ({
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
	await expect(composer.locator("[data-craig-session-id='true']")).toHaveValue("Sessao-epica-42");
	await expect(composer).toContainText("Sessão épica #42.zip");
	await expect(composer).toContainText("Qwen3-ASR · pronto neste Companion");
	await expect(composer).toContainText("Ainda sem calibração nesta máquina.");
	await expect(
		composer.getByText(/Áudio permanece nesta máquina\./u),
	).toBeVisible();
	await expect(composer.getByLabel("Contexto opcional")).not.toBeVisible();

	const chooserPromise = page.waitForEvent("filechooser");
	const dropAction = composer.getByRole("button", {
		name: /Sessão épica #42\.zip/u,
	});
	await dropAction.focus();
	await page.keyboard.press("Enter");
	const chooser = await chooserPromise;
	await chooser.setFiles({
		name: "sessao-42.zip",
		mimeType: "application/zip",
		buffer: Buffer.from("PK replacement"),
	});
	await expect(composer).toContainText("sessao-42.zip");
	await expect(composer.locator("[data-craig-session-id='true']")).toHaveValue("Sessao-epica-42");

	await composer.getByText("Contexto e glossário", { exact: true }).click();
	await expect(composer.getByLabel("Contexto opcional")).toBeVisible();
	await expect(composer.getByLabel("Glossário opcional")).toBeVisible();
});

test("composer preserva arquivo, sessão, contexto e glossário ao trocar tabs", async ({
	page,
}) => {
	await installCompanionFixture(page, { profileReady: true });
	const composer = await openComposer(page);
	await chooseZip(composer);
	await composer.locator("[data-craig-session-id='true']").fill("sessao-persistente");
	await composer.getByText("Contexto e glossário", { exact: true }).click();
	await composer.getByLabel("Contexto opcional").fill("Contexto preservado");
	await composer.getByLabel("Glossário opcional").fill("Yuhara; Pipipi");

	await page.getByRole("tab", { name: "Fila" }).click();
	await page.getByRole("tab", { name: "Visão geral" }).click();

	await expect(composer).toContainText("sessao-42.zip");
	await expect(composer.locator("[data-craig-session-id='true']")).toHaveValue("sessao-persistente");
	await expect(composer.getByLabel("Contexto opcional")).toHaveValue(
		"Contexto preservado",
	);
	await expect(composer.getByLabel("Glossário opcional")).toHaveValue(
		"Yuhara; Pipipi",
	);
});

test("validação local bloqueia arquivo incorreto antes do Companion e archive inválido fica inline", async ({
	page,
}) => {
	const state = await installCompanionFixture(page, {
		profileReady: true,
		craigUploadErrorCode: "CRAIG_ARCHIVE_NO_TRACKS",
	});
	const composer = await openComposer(page);

	await composer.getByLabel("Export do Craig").setInputFiles({
		name: "audio.wav",
		mimeType: "audio/wav",
		buffer: Buffer.from("wav"),
	});
	await expect(composer.getByRole("alert")).toContainText(
		"arquivo .zip exportado pelo Craig",
	);
	expect(state.uploadCount).toBe(0);
	await expect(
		composer.getByRole("button", { name: "Adicionar à fila", exact: true }),
	).toBeDisabled();

	await chooseZip(composer);
	await composer.locator("[data-craig-session-id='true']").fill("sessao-42");
	await composer
		.getByRole("button", { name: "Adicionar à fila", exact: true })
		.click();
	await expect(composer.getByRole("alert")).toContainText(
		"não contém faixas de áudio reconhecidas",
	);
	expect(state.uploadCount).toBe(1);
});

test("pending local mostra validar → preparar → enviar e resume fonte reutilizada", async ({
	page,
}) => {
	const state = await installCompanionFixture(page, {
		profileReady: false,
		craigUploadDelayMs: 350,
		jobPostDelayMs: 400,
		craigReused: true,
		ambiguousJobPostOnce: true,
		advanceJobs: false,
	});
	const composer = await openComposer(page);
	await composer.locator("[data-craig-session-id='true']").fill("sessao-42");
	await chooseZip(composer);

	const initial = composer.getByRole("button", {
		name: "Preparar profile",
		exact: true,
	});
	await expect(initial).toBeEnabled();
	await initial.click();

	await expect(
		composer.getByRole("button", { name: "Validando ZIP…", exact: true }),
	).toBeVisible();
	await expect(
		composer.getByRole("button", { name: "Preparando profile…", exact: true }),
	).toBeVisible({ timeout: 2_000 });
	await expect(composer).toContainText("Já verificada");
	await expect(
		composer.getByRole("button", {
			name: "Enviando ao Companion…",
			exact: true,
		}),
	).toBeVisible({ timeout: 3_500 });

	await expect(composer.getByRole("alert")).toContainText(
		"Não foi possível alcançar o Companion local",
	);
	expect(state.uploadCount).toBe(1);
	expect(state.preparationPostCount).toBe(1);
	expect(state.jobPostCount).toBe(1);
});

test("idle expande composer; running mantém composer em ~1/3 ao lado do cockpit", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
	});
	let composer = await openComposer(page);
	const overview = page.locator("[data-running]");
	await expect(overview).toHaveAttribute("data-running", "false");
	await expect(composer).toHaveAttribute("data-layout", "default");

	const idleBox = await composer.boundingBox();
	expect(idleBox).not.toBeNull();
	expect(idleBox?.width ?? 0).toBeGreaterThan(700);

	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: [
			{
				id: "craig-job-running-layout",
				kind: "transcription.craig",
				status: "running",
				stage: "transcription",
				progress: { completed: 1, total: 2, unit: "tracks" },
				error: null,
				result_available: false,
				updated_at: "2026-09-25T10:00:00Z",
				attempt: 1,
				context: {
					campaign_id: "yuhara-main",
					session_id: "sessao-42",
					source_id: "craig-" + "a".repeat(64),
					profile_id: "qwen-quality",
				},
			},
		],
	});
	await page.reload();
	composer = await openComposer(page);
	await expect(page.locator("[data-running]")).toHaveAttribute(
		"data-running",
		"true",
	);
	await expect(composer).toHaveAttribute("data-layout", "compact");
	const runningOverview = page.locator(
		"#processing-view-overview > div[data-running='true']",
	);
	const runningBox = await runningOverview.boundingBox();
	const composerBox = await composer.boundingBox();
	expect(runningBox).not.toBeNull();
	expect(composerBox).not.toBeNull();
	const share = (composerBox?.width ?? 0) / (runningBox?.width ?? 1);
	expect(share).toBeGreaterThanOrEqual(0.28);
	expect(share).toBeLessThanOrEqual(0.38);
});

test("mobile mantém ordem arquivo → sessão → profile → calibração → CTA → advanced", async ({
	page,
}) => {
	await page.setViewportSize({ width: 320, height: 780 });
	await installCompanionFixture(page, { profileReady: true });
	const composer = await openComposer(page);
	await chooseZip(composer);

	const drop = composer.locator("[data-craig-dropzone='true']");
	const session = composer.locator("[data-craig-session-id='true']");
	const profile = composer.getByLabel("Profile");
	const estimate = composer.getByText("Ainda sem calibração nesta máquina.", {
		exact: true,
	});
	const cta = composer.getByRole("button", {
		name: "Adicionar à fila",
		exact: true,
	});
	const advanced = composer.getByText("Contexto e glossário", { exact: true });

	const boxes = await Promise.all(
		[drop, session, profile, estimate, cta, advanced].map((locator) =>
			locator.boundingBox(),
		),
	);
	expect(boxes.every(Boolean)).toBe(true);
	const ys = boxes.map((box) => box?.y ?? 0);
	for (let index = 1; index < ys.length; index += 1)
		expect(ys[index]).toBeGreaterThan(ys[index - 1]);

	expect(
		await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
	).toBe(true);
});
