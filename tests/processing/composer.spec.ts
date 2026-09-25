import { expect, test } from "@playwright/test";
import {
	fixtureJob,
	installCompanionFixture,
} from "./companion-fixture";

async function openComposer(page: import("@playwright/test").Page) {
	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Nova transcrição Craig" }),
	).toBeVisible();
	return page.locator("[data-processing-composer='true']");
}

async function chooseZip(
	page: import("@playwright/test").Page,
	name = "sessao-42.zip",
) {
	await page.locator("[data-processing-composer='true']").getByLabel("Export do Craig").setInputFiles({
		name,
		mimeType: name.endsWith(".zip") ? "application/zip" : "audio/wav",
		buffer: Buffer.from("PK synthetic Craig fixture"),
	});
}

test("dropzone keyboard seleciona ZIP sem native input dominar a superfície", async ({
	page,
}) => {
	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
	});
	const composer = await openComposer(page);
	const picker = page.getByRole("button", {
		name: /Arraste o ZIP do Craig aqui/i,
	});
	await expect(picker).toBeVisible();

	const chooserPromise = page.waitForEvent("filechooser");
	await picker.focus();
	await picker.press("Enter");
	const chooser = await chooserPromise;
	await chooser.setFiles({
		name: "teclado.zip",
		mimeType: "application/zip",
		buffer: Buffer.from("PK keyboard fixture"),
	});

	await expect(composer.locator("[data-selected-file='true']")).toContainText(
		"teclado.zip",
	);
	await expect(composer.locator("[data-selected-file='true']")).toContainText(
		"ZIP selecionado",
	);
	await expect(page.locator("[data-processing-composer='true']").getByLabel("Export do Craig")).toHaveCount(1);
});

test("drag and drop aceita um ZIP e rejeita extensão inválida antes do upload", async ({
	page,
}) => {
	const state = await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
	});
	await openComposer(page);
	const dropzone = page.locator("[data-craig-dropzone='true']");

	await dropzone.evaluate((element) => {
		const data = new DataTransfer();
		data.items.add(
			new File(["not zip"], "audio.wav", { type: "audio/wav" }),
		);
		element.dispatchEvent(
			new DragEvent("drop", {
				bubbles: true,
				cancelable: true,
				dataTransfer: data,
			}),
		);
	});
	await expect(page.getByRole("alert")).toContainText("extensão .zip");
	await expect(
		page.getByRole("button", { name: "Adicionar à fila" }),
	).toBeDisabled();
	expect(state.uploadCount).toBe(0);

	await dropzone.evaluate((element) => {
		const data = new DataTransfer();
		data.items.add(
			new File(["PK valid"], "arrastado.zip", {
				type: "application/zip",
			}),
		);
		element.dispatchEvent(
			new DragEvent("drop", {
				bubbles: true,
				cancelable: true,
				dataTransfer: data,
			}),
		);
	});
	await expect(page.getByRole("alert")).not.toBeVisible();
	await expect(page.getByText("arrastado.zip", { exact: true })).toBeVisible();
});

test("composer mostra apenas fatos disponíveis, privacy e ausência explícita de calibração", async ({
	page,
}) => {
	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
	});
	const composer = await openComposer(page);
	await chooseZip(page);

	await expect(composer).toContainText("Qwen3-ASR · qualidade");
	await expect(composer).toContainText("Profile pronto neste Companion.");
	await expect(composer).toContainText("Ainda sem calibração de tempo nesta máquina.");
	await expect(composer).toContainText("🔒 Áudio permanece nesta máquina.");
	await expect(composer).not.toContainText(/recomendado|melhor profile|score/i);

	await expect(page.locator("[data-processing-composer='true']").getByLabel("Contexto opcional")).not.toBeVisible();
	await expect(page.locator("[data-processing-composer='true']").getByLabel("Glossário opcional")).not.toBeVisible();
	await page.getByText("Contexto e glossário", { exact: true }).click();
	await expect(page.locator("[data-processing-composer='true']").getByLabel("Contexto opcional")).toBeVisible();
	await expect(page.locator("[data-processing-composer='true']").getByLabel("Glossário opcional")).toBeVisible();

	await page.getByText("Como funciona", { exact: true }).click();
	await expect(composer).toContainText(
		"O navegador envia o ZIP somente ao Companion em loopback.",
	);
});

test("estado do composer sobrevive à troca de tabs", async ({ page }) => {
	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
	});
	await openComposer(page);
	await chooseZip(page, "persistente.zip");
	await page.locator("[data-processing-composer='true']").getByLabel("Sessão", { exact: true }).fill("sessao-persistente");
	await page.getByText("Contexto e glossário", { exact: true }).click();
	await page.locator("[data-processing-composer='true']").getByLabel("Contexto opcional").fill("contexto que precisa sobreviver");
	await page.locator("[data-processing-composer='true']").getByLabel("Glossário opcional").fill("Yuhara, Dandelion");

	await page.getByRole("tab", { name: "Fila" }).click();
	await page.getByRole("tab", { name: "Visão geral" }).click();

	await expect(page.locator("[data-processing-composer='true']").getByLabel("Sessão", { exact: true })).toHaveValue("sessao-persistente");
	await expect(page.getByText("persistente.zip", { exact: true })).toBeVisible();
	await expect(page.locator("[data-processing-composer='true']").getByLabel("Contexto opcional")).toHaveValue(
		"contexto que precisa sobreviver",
	);
	await expect(page.locator("[data-processing-composer='true']").getByLabel("Glossário opcional")).toHaveValue(
		"Yuhara, Dandelion",
	);
});

test("pending é local e mostra fase de envio ao Companion", async ({ page }) => {
	await page.addInitScript(() => {
		const starts: string[] = [];
		(window as Window & { __globalLoadingStarts?: string[] }).__globalLoadingStarts =
			starts;
		window.addEventListener("tda:global-loading-start", (event) => {
			const detail = (event as CustomEvent<{ id?: string }>).detail;
			starts.push(detail?.id ?? "unknown");
		});
	});
	const state = await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		uploadDelayMs: 700,
	});
	await openComposer(page);
	await page.locator("[data-processing-composer='true']").getByLabel("Sessão", { exact: true }).fill("sessao-42");
	await chooseZip(page);

	const submit = page.getByRole("button", { name: "Adicionar à fila" });
	await submit.click();
	await expect(
		page.getByRole("button", { name: "Enviando ao Companion…" }),
	).toBeDisabled();
	await expect(page.getByText(/validação acontece no Agent/i)).toBeVisible();
	expect(
		await page.evaluate(
			() =>
				(window as Window & { __globalLoadingStarts?: string[] })
					.__globalLoadingStarts ?? [],
		),
	).toEqual([]);

	await expect.poll(() => state.jobPostCount).toBe(1);
});

test("profile não pronto comunica preparação antes do clique e mantém estimate ausente", async ({
	page,
}) => {
	await installCompanionFixture(page, {
		profileReady: false,
		advanceJobs: false,
	});
	const composer = await openComposer(page);
	await chooseZip(page);
	await page.locator("[data-processing-composer='true']").getByLabel("Sessão", { exact: true }).fill("sessao-42");

	await expect(
		page.getByRole("button", { name: "Preparar profile" }),
	).toBeEnabled();
	await expect(composer).toContainText("Preparação local necessária");
	await expect(composer).toContainText("Ainda sem calibração de tempo nesta máquina.");
	await expect(composer).toContainText(
		"O Qwen precisa ser preparado e validado novamente nesta GPU",
	);
});

test("source validada mostra track count factual e retry ambíguo reaproveita a fonte", async ({
	page,
}) => {
	const state = await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		ambiguousJobPostOnce: true,
	});
	await openComposer(page);
	await page.locator("[data-processing-composer='true']").getByLabel("Sessão", { exact: true }).fill("sessao-42");
	await chooseZip(page);

	await page.getByRole("button", { name: "Adicionar à fila" }).click();
	await expect(page.getByRole("alert")).toContainText(
		"Não foi possível alcançar o Companion local",
	);
	await expect(page.locator("[data-selected-file='true']")).toContainText(
		"2 tracks",
	);
	expect(state.uploadCount).toBe(1);

	await page.getByRole("button", { name: "Adicionar à fila" }).click();
	await expect.poll(() => state.jobPostCount).toBe(2);
	expect(state.uploadCount).toBe(1);
});

test("última sessão vira somente sugestão explícita após submissão bem-sucedida", async ({
	page,
}) => {
	const state = await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
	});
	await openComposer(page);
	await page.locator("[data-processing-composer='true']").getByLabel("Sessão", { exact: true }).fill("sessao-42");
	await chooseZip(page);
	await page.getByRole("button", { name: "Adicionar à fila" }).click();
	await expect.poll(() => state.jobPostCount).toBe(1);

	await page.locator("[data-processing-composer='true']").getByLabel("Sessão", { exact: true }).fill("");
	await expect(page.locator("[data-processing-composer='true']").getByLabel("Sessão", { exact: true })).toHaveValue("");
	const suggestion = page.getByRole("button", {
		name: "Usar última sessão: sessao-42",
	});
	await expect(suggestion).toBeVisible();
	await suggestion.click();
	await expect(page.locator("[data-processing-composer='true']").getByLabel("Sessão", { exact: true })).toHaveValue("sessao-42");
});

test("running mantém composer compacto e idle permite o composer crescer", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: [fixtureJob("running")],
	});
	await openComposer(page);

	const top = page.locator("[data-processing-overview-top='true']");
	const runningComposer = top.locator("section[data-layout='compact']");
	await expect(top).toHaveAttribute("data-active-job", "true");
	await expect(runningComposer).toBeVisible();
	const topBox = await top.boundingBox();
	const compactBox = await runningComposer.boundingBox();
	expect(topBox).not.toBeNull();
	expect(compactBox).not.toBeNull();
	expect((compactBox?.width ?? 0) / (topBox?.width ?? 1)).toBeLessThanOrEqual(0.4);
});
