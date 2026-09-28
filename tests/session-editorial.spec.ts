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
		.getByRole("button", { name: /^Salvar (sessão|resumo)$/u })
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

test("workspace separates transcript, session metadata and live Markdown preview without losing the working copy", async ({
	page,
}) => {
	await page.goto("/e2e-fixtures/session-editorial");

	await expect(page.getByRole("tab", { name: "Transcrição" })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(page.getByText(PRIVATE_MARKER, { exact: false })).toBeVisible();
	await expect(page.getByLabel("Título")).toBeHidden();

	await page.getByRole("tab", { name: "Sessão" }).click();
	await page.getByLabel("Título").fill("Working copy entre abas");
	await expect(page.getByText(PRIVATE_MARKER, { exact: false })).toBeHidden();

	await page.getByRole("tab", { name: "Resumo" }).click();
	await page
		.getByLabel("Resumo completo em Markdown")
		.fill("# Preview vivo\n\n**Markdown** renderizado sem publicar.");
	await expect(page.getByRole("region", { name: "Markdown bruto" })).toBeVisible();
	await expect(page.getByRole("region", { name: "Preview do Markdown" })).toContainText(
		"Markdown renderizado sem publicar.",
	);

	await page.getByRole("tab", { name: "Sessão" }).click();
	await expect(page.getByLabel("Título")).toHaveValue("Working copy entre abas");
	await page.getByRole("tab", { name: "Resumo" }).click();
	await expect(page.getByLabel("Resumo completo em Markdown")).toHaveValue(
		"# Preview vivo\n\n**Markdown** renderizado sem publicar.",
	);
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
	await page.getByRole("button", { name: "Salvar sessão" }).click();

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

test("desktop transcript toolbar stays clear of floating global chrome while sticky", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1366, height: 768 });
	await page.goto("/e2e-fixtures/session-editorial");

	const search = page.getByLabel("Buscar fala ou speaker");
	const toolbar = search.locator("xpath=ancestor::div[1]");
	await expect(search).toBeVisible();
	expect(await toolbar.evaluate((element) => getComputedStyle(element).position)).toBe("sticky");

	await page.evaluate(() => {
		const spacer = document.createElement("div");
		spacer.dataset.testid = "session-editorial-floating-shell-spacer";
		spacer.style.height = "1400px";
		document
			.querySelector('section[aria-label="Leitor e editor de transcrição"]')
			?.append(spacer);
		window.scrollTo(0, 700);
	});
	await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);

	const chromeBottom = await page.evaluate(() => {
		const brand = document.querySelector<HTMLElement>(".brand")?.getBoundingClientRect();
		const trigger = document
			.querySelector<HTMLElement>(".account-menu-trigger")
			?.getBoundingClientRect();
		return Math.max(brand?.bottom ?? 0, trigger?.bottom ?? 0);
	});
	const toolbarBox = await toolbar.boundingBox();
	expect(toolbarBox).not.toBeNull();
	if (toolbarBox) expect(toolbarBox.y).toBeGreaterThanOrEqual(chromeBottom + 4);
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
