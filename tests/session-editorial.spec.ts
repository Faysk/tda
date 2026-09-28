import { expect, test, type Page } from "@playwright/test";

const PRIVATE_MARKER = "NEVER_PUBLIC_TRANSCRIPT_MARKER_9F3A";

async function fillReadyDraft(page: Page, suffix = "") {
	await page.getByRole("tab", { name: "Sessão" }).click();
	await page.getByRole("button", { name: "Usar capa sintética finalizada" }).click();
	await page.getByLabel("Arco").fill("Arco Sintético");
	await page.getByLabel("Título").fill(`Sessão Editorial Sintética${suffix}`);
	await page.getByLabel("Data").fill("2026-09-28");
	await page
		.getByLabel("Descrição")
		.fill(`Descrição pública sintética${suffix}.`);
	await page.getByRole("tab", { name: "Resumo" }).click();
	await page
		.getByLabel("Resumo completo em Markdown")
		.fill(`# Resumo público sintético${suffix}\n\nTexto público deliberado${suffix}.`);
}

async function saveDraft(page: Page, revision: number) {
	await page
		.getByRole("button", { name: /^Salvar (draft|resumo)$/u })
		.click();
	await expect(page.getByText(`Draft r${revision} salvo.`, { exact: true })).toBeVisible();
}

async function publish(page: Page, label = "Publicar no site") {
	await page.getByRole("tab", { name: "Sessão" }).click();
	await page.getByRole("button", { name: label, exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Confirmar publicação da sessão" });
	await expect(dialog).toBeVisible();
	await dialog.getByRole("button", { name: label, exact: true }).click();
	return dialog;
}

test("desktop workbench keeps transcript and editorial work visible together without losing the working copy", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto("/e2e-fixtures/session-editorial");

	await expect(page.getByText(PRIVATE_MARKER, { exact: false })).toBeVisible();
	await expect(page.getByLabel("Título")).toBeVisible();
	await expect(page.getByRole("region", { name: "Transcrição da sessão" })).toBeVisible();
	await expect(page.getByRole("region", { name: "Edição editorial da sessão" })).toBeVisible();

	await page.getByLabel("Título").fill("Working copy entre painéis");
	await page.getByRole("tab", { name: "Resumo / Preview", exact: true }).click();
	await page
		.getByLabel("Resumo completo em Markdown")
		.fill("# Preview vivo\n\n**Markdown** renderizado sem publicar.");
	await expect(page.getByRole("region", { name: "Markdown bruto" })).toBeVisible();
	await expect(page.getByRole("region", { name: "Preview do Markdown" })).toContainText(
		"Markdown renderizado sem publicar.",
	);

	await page.getByRole("tab", { name: "Sessão", exact: true }).click();
	await expect(page.getByLabel("Título")).toHaveValue("Working copy entre painéis");
	await expect(page.getByText(PRIVATE_MARKER, { exact: false })).toBeVisible();
});

test("private transcript -> draft -> publish -> replace keeps transcript out of the public snapshot", async ({
	page,
}) => {
	await page.goto("/e2e-fixtures/session-editorial");

	const publicSurface = page.getByTestId("synthetic-public-session");
	await expect(publicSurface).toContainText("Nenhuma publicação pública.");
	await expect(publicSurface).not.toContainText(PRIVATE_MARKER);

	await expect(page.getByText(PRIVATE_MARKER, { exact: false })).toBeVisible();
	await page.getByLabel("Buscar fala ou speaker").fill(PRIVATE_MARKER);
	await expect(page.getByText("1 resultado(s)", { exact: true })).toBeVisible();
	await page.getByLabel("Ir para timestamp").fill("01:02:03");
	await page.getByRole("button", { name: "Ir", exact: true }).click();

	const download = await page.request.get(
		"/e2e-fixtures/session-editorial/transcript",
	);
	expect(download.status()).toBe(200);
	expect(download.headers()["cache-control"]).toBe("private, no-store");
	expect(download.headers()["content-type"]).toBe(
		"text/markdown; charset=utf-8",
	);
	expect(await download.text()).toContain(PRIVATE_MARKER);

	await fillReadyDraft(page);
	await saveDraft(page, 1);
	await expect(publicSurface).toContainText("Nenhuma publicação pública.");
	await expect(publicSurface).not.toContainText(PRIVATE_MARKER);

	await expect(page.getByRole("region", { name: "Markdown bruto" })).toBeVisible();
	await expect(page.getByRole("region", { name: "Preview do Markdown" })).toBeVisible();
	await expect(
		page.getByRole("region", { name: "Preview do Markdown" }),
	).toContainText("Texto público deliberado.");

	await publish(page);
	await expect(publicSurface.locator("article")).toHaveAttribute(
		"data-public-version",
		"1",
	);
	await expect(publicSurface).toContainText("Sessão Editorial Sintética");
	await expect(publicSurface).toContainText("Texto público deliberado.");
	await expect(publicSurface).not.toContainText(PRIVATE_MARKER);

	await page.getByRole("tab", { name: "Sessão" }).click();
	await page.getByLabel("Descrição").fill("Descrição pública substituta.");
	await page.getByRole("tab", { name: "Resumo" }).click();
	await page
		.getByLabel("Resumo completo em Markdown")
		.fill("# Segunda versão\n\nResumo público substituto.");
	await saveDraft(page, 2);

	await expect(publicSurface).toContainText("Texto público deliberado.");
	await expect(publicSurface).not.toContainText("Resumo público substituto.");

	await publish(page, "Publicar nova versão");
	await expect(publicSurface.locator("article")).toHaveAttribute(
		"data-public-version",
		"2",
	);
	await expect(publicSurface).toContainText("Resumo público substituto.");
	await expect(publicSurface).not.toContainText(PRIVATE_MARKER);
});

test("draft CAS conflict preserves the local working copy until explicit reconciliation", async ({
	page,
}) => {
	await page.goto("/e2e-fixtures/session-editorial");
	await fillReadyDraft(page);
	await saveDraft(page, 1);

	await page.getByRole("tab", { name: "Sessão" }).click();
	const title = page.getByLabel("Título");
	await title.fill("Minha working copy local");
	await page.getByRole("button", { name: "Simular save concorrente" }).click();
	await expect(page.getByTestId("remote-draft-revision")).toHaveText("2");
	await page.getByRole("button", { name: "Salvar draft" }).click();

	await expect(page.getByRole("alert").filter({ hasText: "Conflito de edição" })).toBeVisible();
	await expect(title).toHaveValue("Minha working copy local");
	await page
		.getByRole("button", { name: "Manter minha working copy sobre r2" })
		.click();
	await expect(title).toHaveValue("Minha working copy local");
	await saveDraft(page, 3);
});

test("transcript revision drift updates immediately without discarding editorial working copy", async ({
	page,
}) => {
	await page.goto("/e2e-fixtures/session-editorial");
	await fillReadyDraft(page);
	await saveDraft(page, 1);

	await page.getByRole("tab", { name: "Sessão" }).click();
	const title = page.getByLabel("Título");
	await title.fill("Minha edição editorial ainda não salva");
	await page
		.getByRole("button", { name: "Simular nova revisão de transcrição" })
		.click();

	await expect(
		page.getByText(
			"A transcrição foi atualizada desde a base deste draft. O conteúdo editorial foi preservado; revise a diferença antes de publicar.",
			{ exact: true },
		),
	).toBeVisible();
	await expect(title).toHaveValue("Minha edição editorial ainda não salva");
	await expect(
		page.getByRole("button", { name: "Publicar no site", exact: true }),
	).toBeDisabled();
});

test("lost publication response replays the same operation without creating another public version", async ({
	page,
}) => {
	await page.goto("/e2e-fixtures/session-editorial");
	await fillReadyDraft(page);
	await saveDraft(page, 1);
	await page
		.getByRole("button", { name: "Perder próxima resposta de publicação" })
		.click();

	const dialog = await publish(page);
	const publicSurface = page.getByTestId("synthetic-public-session");
	await expect(publicSurface.locator("article")).toHaveAttribute(
		"data-public-version",
		"1",
	);
	await expect(
		page.getByText(
			"O commit pode ter ocorrido, mas o read-back não confirmou. Tente novamente: a mesma operação será reutilizada sem duplicar versão.",
			{ exact: true },
		),
	).toBeVisible();

	await dialog.getByRole("button", { name: "Publicar no site", exact: true }).click();
	await expect(page.getByText(/Publicação recuperada.*versão pública v1/u)).toBeVisible();
	await expect(publicSurface.locator("article")).toHaveAttribute(
		"data-public-version",
		"1",
	);
	await expect(publicSurface).not.toContainText(PRIVATE_MARKER);
});

test("cover promotion failure and capability loss fail closed without mutating the public snapshot", async ({
	page,
}) => {
	await page.goto("/e2e-fixtures/session-editorial");
	await fillReadyDraft(page);
	await saveDraft(page, 1);

	await page.getByRole("tab", { name: "Sessão" }).click();
	await page.getByLabel("Permitir publicação").uncheck();
	await expect(page.getByRole("button", { name: "Publicar no site" })).toBeDisabled();
	await page.getByLabel("Permitir publicação").check();
	await page.getByRole("button", { name: "Falhar próxima promoção da capa" }).click();

	await publish(page);
	await expect(
		page.getByText(
			"A capa não pôde ser promovida e verificada publicamente. A versão anterior continua ativa.",
			{ exact: true },
		),
	).toBeVisible();
	await expect(page.getByTestId("synthetic-public-session")).toContainText(
		"Nenhuma publicação pública.",
	);

	await page.getByLabel("Permitir edição").uncheck();
	await expect(page.getByLabel("Título")).toBeDisabled();
	await expect(
		page.getByRole("button", { name: "Usar capa sintética finalizada" }),
	).toBeDisabled();
});

test("editorial workbench header never collides with floating global chrome", async ({ page }) => {
	for (const viewport of [
		{ width: 1366, height: 768 },
		{ width: 390, height: 844 },
		{ width: 320, height: 800 },
	]) {
		await page.setViewportSize(viewport);
		await page.goto("/e2e-fixtures/session-editorial");
		const [heading, brand, trigger] = await Promise.all([
			page.getByRole("heading", { name: "Session Editorial E2E", exact: true }).boundingBox(),
			page.locator(".brand").boundingBox(),
			page.locator(".account-menu-trigger").boundingBox(),
		]);
		expect(heading).not.toBeNull();
		expect(brand).not.toBeNull();
		expect(trigger).not.toBeNull();
		if (!heading || !brand || !trigger) continue;

		const overlaps = (
			a: { x: number; y: number; width: number; height: number },
			b: { x: number; y: number; width: number; height: number },
		) =>
			a.x < b.x + b.width &&
			a.x + a.width > b.x &&
			a.y < b.y + b.height &&
			a.y + a.height > b.y;

		expect(overlaps(heading, brand)).toBeFalsy();
		expect(overlaps(heading, trigger)).toBeFalsy();
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth + 1,
			),
		).toBeTruthy();
	}
});

test("desktop transcript owns its scroll while the editorial action bar remains reachable", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto("/e2e-fixtures/session-editorial");

	const frame = page.getByTestId("session-editorial-workspace-frame");
	await frame.evaluate((element) => {
		(element as HTMLElement).style.height = "560px";
	});
	const transcript = page.getByRole("region", { name: "Transcrição da sessão" });
	const editorial = page.getByRole("region", { name: "Edição editorial da sessão" });
	await expect(transcript).toBeVisible();
	await expect(editorial).toBeVisible();

	await transcript.evaluate((element) => {
		const spacer = document.createElement("div");
		spacer.style.height = "1200px";
		element.append(spacer);
		element.scrollTop = 420;
	});
	expect(await transcript.evaluate((element) => element.scrollTop)).toBeGreaterThan(100);
	expect(await page.evaluate(() => window.scrollY)).toBe(0);
	expect(await transcript.evaluate((element) => getComputedStyle(element).overflowY)).toBe("auto");
	expect(await editorial.evaluate((element) => getComputedStyle(element).overflowY)).toBe("auto");

	const actionBar = editorial.locator("footer");
	await expect(actionBar).toBeVisible();
	expect(await actionBar.evaluate((element) => getComputedStyle(element).position)).toBe("sticky");
	await expect(actionBar.getByRole("button", { name: "Preview", exact: true })).toBeVisible();
	await expect(actionBar.getByRole("button", { name: "Publicar no site", exact: true })).toBeVisible();
});

test("session workbench floating-shell receipts cover desktop, mobile and zoom", async ({
	page,
}, testInfo) => {
	for (const receipt of [
		{ name: "workbench-1920", viewport: { width: 1920, height: 1080 } },
		{ name: "workbench-1440", viewport: { width: 1440, height: 900 } },
		{ name: "workbench-1366", viewport: { width: 1366, height: 768 } },
		{ name: "workbench-mobile-390", viewport: { width: 390, height: 844 } },
		{ name: "workbench-mobile-320", viewport: { width: 320, height: 800 } },
		{ name: "workbench-zoom-200", viewport: { width: 683, height: 384 } },
	]) {
		await page.setViewportSize(receipt.viewport);
		await page.goto("/e2e-fixtures/session-editorial");
		await expect(page.getByRole("tab", { name: "Transcrição" })).toBeVisible();
		await expect(page.locator(".brand")).toBeVisible();
		await expect(page.locator(".account-menu-trigger")).toBeVisible();
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth + 1,
			),
		).toBeTruthy();
		await page.screenshot({
			path: testInfo.outputPath(`${receipt.name}.png`),
			fullPage: false,
		});
	}
});

test("mobile workspace is segmented instead of squeezing the two desktop panes", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/e2e-fixtures/session-editorial");

	await expect(page.getByRole("tab", { name: "Transcrição", exact: true })).toBeVisible();
	await expect(page.getByText(PRIVATE_MARKER, { exact: false })).toBeVisible();
	await expect(page.getByLabel("Título")).toBeHidden();

	await page.getByRole("tab", { name: "Sessão", exact: true }).click();
	await expect(page.getByLabel("Título")).toBeVisible();
	await expect(page.getByText(PRIVATE_MARKER, { exact: false })).toBeHidden();
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth + 1,
		),
	).toBeTruthy();
});

test("large 7500-segment transcript stays searchable without mounting every row at once", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1920, height: 1080 });
	await page.goto("/e2e-fixtures/session-editorial?segments=7500");

	const rows = page.locator("[data-transcript-segment]");
	expect(await rows.count()).toBeLessThan(7500);
	await page.getByLabel("Buscar fala ou speaker").fill("Segmento sintético 7500");
	await expect(page.getByText("1 resultado(s)", { exact: true })).toBeVisible();
	await expect(page.getByText("Segmento sintético 7500", { exact: false })).toBeVisible();
});

test("mobile workspace and publication dialog remain inside the viewport", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/e2e-fixtures/session-editorial");
	await fillReadyDraft(page);
	await saveDraft(page, 1);
	await page.getByRole("tab", { name: "Sessão" }).click();
	await page.getByRole("button", { name: "Publicar no site" }).click();

	const dialog = page.getByRole("dialog", { name: "Confirmar publicação da sessão" });
	await expect(dialog).toBeVisible();
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth + 1,
		),
	).toBeTruthy();
	const box = await dialog.boundingBox();
	expect(box).not.toBeNull();
	if (box) {
		expect(box.x).toBeGreaterThanOrEqual(-1);
		expect(box.x + box.width).toBeLessThanOrEqual(391);
	}
	await dialog.getByRole("button", { name: "Cancelar" }).click();
	await expect(dialog).toHaveCount(0);
});
