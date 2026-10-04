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
	await dialog
		.getByRole("button", {
			name:
				label === "Publicar nova versão"
					? "Confirmar nova versão"
					: "Confirmar e publicar",
			exact: true,
		})
		.click();
	return dialog;
}

async function openCampaignMove(page: Page) {
	const panel = page.getByTestId("session-campaign-move-panel");
	await expect(panel).toBeVisible();
	await panel.locator("summary").click();
	return panel;
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

	await dialog
		.getByRole("button", { name: "Confirmar e publicar", exact: true })
		.click();
	await expect(page.getByText(/Publicação recuperada.*versão pública v1/u)).toBeVisible();
	await expect(publicSurface.locator("article")).toHaveAttribute(
		"data-public-version",
		"1",
	);
	await expect(publicSurface).not.toContainText(PRIVATE_MARKER);
});

test("cover replacement in flight blocks publication until the new asset finishes and the draft is saved", async ({
	page,
}) => {
	await page.goto("/e2e-fixtures/session-editorial");
	await fillReadyDraft(page);
	await saveDraft(page, 1);
	await page.getByRole("tab", { name: "Sessão" }).click();

	const publishButton = page.getByRole("button", {
		name: "Publicar no site",
		exact: true,
	});
	await expect(publishButton).toBeEnabled();

	await page.getByRole("button", { name: "Simular troca de capa em andamento" }).click();
	await expect(page.getByTestId("synthetic-cover-phase")).toHaveText("uploading");
	await expect(page.getByText("Capa em preparação", { exact: true })).toBeVisible();
	await expect(
		page.getByText(
			"Capa: envio ou validação em andamento. A publicação fica bloqueada até concluir.",
			{ exact: true },
		),
	).toBeVisible();
	await expect(publishButton).toBeDisabled();
	await expect(
		page.getByRole("dialog", { name: "Confirmar publicação da sessão" }),
	).not.toBeVisible();

	await page.getByRole("button", { name: "Simular validação da nova capa" }).click();
	await expect(page.getByTestId("synthetic-cover-phase")).toHaveText("finalizing");
	await expect(publishButton).toBeDisabled();

	await page.getByRole("button", { name: "Concluir troca de capa" }).click();
	await expect(page.getByTestId("synthetic-cover-phase")).toHaveText("ready");
	await expect(page.getByTestId("synthetic-cover-reference")).toHaveText(
		"/assets/sessions/synthetic-editorial-cover-replacement.webp",
	);
	await expect(publishButton).toBeDisabled();
	await expect(page.getByText("Alterações não salvas", { exact: true })).toBeVisible();

	await saveDraft(page, 2);
	await expect(publishButton).toBeEnabled();
	await publish(page);
	await expect(page.getByTestId("synthetic-public-session")).toContainText(
		"/assets/sessions/synthetic-editorial-cover-replacement.webp",
	);
});

test("cancelled or failed cover replacement preserves the saved cover and releases the publish gate", async ({
	page,
}) => {
	await page.goto("/e2e-fixtures/session-editorial");
	await fillReadyDraft(page);
	await saveDraft(page, 1);
	await page.getByRole("tab", { name: "Sessão" }).click();

	const publishButton = page.getByRole("button", {
		name: "Publicar no site",
		exact: true,
	});
	const coverReference = page.getByTestId("synthetic-cover-reference");

	await page.getByRole("button", { name: "Simular troca de capa em andamento" }).click();
	await expect(publishButton).toBeDisabled();
	await page.getByRole("button", { name: "Cancelar troca de capa" }).click();
	await expect(page.getByTestId("synthetic-cover-phase")).toHaveText("cancelled");
	await expect(coverReference).toHaveText(
		"/assets/sessions/synthetic-editorial-cover.webp",
	);
	await expect(publishButton).toBeEnabled();

	await page.getByRole("button", { name: "Simular troca de capa em andamento" }).click();
	await expect(publishButton).toBeDisabled();
	await page.getByRole("button", { name: "Falhar troca de capa" }).click();
	await expect(page.getByTestId("synthetic-cover-phase")).toHaveText("error");
	await expect(coverReference).toHaveText(
		"/assets/sessions/synthetic-editorial-cover.webp",
	);
	await expect(publishButton).toBeEnabled();
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

	const dialog = await publish(page);
	await expect(
		page.getByText(
			"A capa não pôde ser promovida e verificada publicamente. A versão anterior continua ativa.",
			{ exact: true },
		),
	).toBeVisible();
	await expect(page.getByTestId("synthetic-public-session")).toContainText(
		"Nenhuma publicação pública.",
	);
	await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
	await expect(dialog).not.toBeVisible();

	await page.getByLabel("Permitir edição").uncheck();
	await expect(page.getByLabel("Título")).toBeDisabled();
	await expect(
		page.getByRole("button", { name: "Usar capa sintética finalizada" }),
	).toBeDisabled();
});

test("session campaign move preflight keeps blockers actionable on keyboard and mobile", async ({
	page,
}) => {
	await page.setViewportSize({ width: 320, height: 800 });
	await page.goto("/e2e-fixtures/session-editorial");
	await openCampaignMove(page);

	const selector = page.getByLabel("Mover para outra campanha");
	await selector.selectOption("campanha-bloqueada");
	await selector.focus();
	await page.keyboard.press("Tab");
	const preflight = page.getByRole("button", { name: "Pré-validar mudança" });
	await expect(preflight).toBeFocused();
	await page.keyboard.press("Enter");

	await expect(page.getByRole("heading", { name: "Mudança bloqueada" })).toBeVisible();
	await expect(page.getByText("Dependência sintética impede o move.")).toBeVisible();
	await expect(page.getByRole("button", { name: /Confirmar mudança/u })).toHaveCount(0);

	await selector.selectOption("campanha-b");
	await preflight.click();
	await expect(page.getByRole("heading", { name: "Pronta para confirmar" })).toBeVisible();
	await expect(
		page.getByText("O deep link do Edit passa a usar a campanha de destino.", {
			exact: true,
		}),
	).toBeVisible();
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth + 1,
		),
	).toBeTruthy();
});

test("session campaign move stays fail-closed when the backend migration is unavailable", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto("/e2e-fixtures/session-editorial?moveBackend=unavailable");

	await expect(page.getByTestId("session-campaign-move-unavailable")).toBeVisible();
	await expect(
		page.getByText("Mover campanha indisponível", { exact: true }),
	).toBeVisible();
	await expect(
		page.getByText(/A operação ainda não está ativa neste ambiente/u),
	).toBeVisible();
	await expect(page.getByRole("button", { name: "Pré-validar mudança" })).toHaveCount(0);
	await expect(page.getByLabel("Mover para outra campanha")).toHaveCount(0);
});


test("lost move response reuses operation id and recovers cache without hiding committed state", async ({
	page,
}) => {
	await page.goto("/e2e-fixtures/session-editorial");
	await openCampaignMove(page);
	const selector = page.getByLabel("Mover para outra campanha");
	const preflight = page.getByRole("button", { name: "Pré-validar mudança" });
	await selector.selectOption("campanha-b");
	await preflight.click();
	await expect(page.getByRole("heading", { name: "Pronta para confirmar" })).toBeVisible();

	await page.getByRole("button", { name: "Perder próxima resposta de move" }).click();
	const confirm = page.getByRole("button", { name: "Confirmar mudança para Campanha B" });
	await confirm.click();
	await expect(
		page.getByRole("alert").filter({
			hasText: "A resposta se perdeu. Use “Confirmar mudança” novamente",
		}),
	).toBeVisible();

	const urlBeforeRecovery = page.url();
	await confirm.click();
	await expect(page.getByText("Commit confirmado.", { exact: true })).toBeVisible();
	await expect(
		page.getByText("Destino confirmado: Campanha B (campanha-b).", { exact: true }),
	).toBeVisible();
	await expect(
		page.getByText(/A sessão já mudou de campanha no banco.*revalidação de cache\/delivery/u),
	).toBeVisible();
	await expect(page.getByRole("button", { name: "Abrir destino confirmado" })).toBeVisible();
	const retry = page.getByRole("button", { name: "Revalidar caches" });
	await expect(retry).toBeVisible();
	await expect(selector).toBeDisabled();
	await expect(preflight).toBeDisabled();
	expect(page.url()).toBe(urlBeforeRecovery);

	const ids = ((await page.getByTestId("synthetic-move-operation-ids").textContent()) ?? "")
		.split("|")
		.filter(Boolean);
	expect(ids).toHaveLength(2);
	expect(ids[0]).toBe(ids[1]);

	await retry.click();
	await expect(page).toHaveURL(/move=committed/u);
	const recoveredUrl = new URL(page.url());
	expect(recoveredUrl.searchParams.get("operationId")).toBe(ids[0]);
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

	const shell = page.getByTestId("session-editorial-shell");
	const frame = page.getByTestId("session-editorial-workspace-frame");
	const move = page.getByTestId("session-campaign-move-panel");
	const [shellBox, frameBox, moveBox] = await Promise.all([
		shell.boundingBox(),
		frame.boundingBox(),
		move.boundingBox(),
	]);
	expect(shellBox).not.toBeNull();
	expect(frameBox).not.toBeNull();
	expect(moveBox).not.toBeNull();
	if (shellBox && frameBox && moveBox) {
		expect(shellBox.height).toBeLessThanOrEqual(901);
		expect(frameBox.height).toBeGreaterThan(420);
		expect(moveBox.height).toBeLessThan(90);
		expect(frameBox.y).toBeGreaterThanOrEqual(moveBox.y + moveBox.height - 2);
	}
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

test("publication confirmation opens in the top layer, receives focus and restores the trigger", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto("/e2e-fixtures/session-editorial");
	await fillReadyDraft(page);
	await saveDraft(page, 1);
	await page.getByRole("tab", { name: "Sessão" }).click();

	const editorial = page.getByRole("region", { name: "Edição editorial da sessão" });
	await editorial.evaluate((element) => {
		element.scrollTop = element.scrollHeight;
	});
	const trigger = editorial.getByRole("button", {
		name: "Publicar no site",
		exact: true,
	});
	await expect(trigger).toBeVisible();
	await trigger.click();

	const dialog = page.getByRole("dialog", { name: "Confirmar publicação da sessão" });
	await expect(dialog).toBeVisible();
	await expect(dialog.locator("strong").first()).toBeFocused();
	const box = await dialog.boundingBox();
	expect(box).not.toBeNull();
	if (box) {
		expect(box.y).toBeGreaterThanOrEqual(-1);
		expect(box.y + box.height).toBeLessThanOrEqual(901);
	}

	await page.keyboard.press("Escape");
	await expect(dialog).not.toBeVisible();
	await expect(trigger).toBeFocused();

	await trigger.click();
	await expect(dialog).toBeVisible();
	await expect(
		dialog.getByRole("button", { name: "Confirmar e publicar", exact: true }),
	).toBeVisible();
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
		await page.getByTestId("session-editorial-failure-controls").evaluate((element) => {
			(element as HTMLElement).style.display = "none";
		});
		const shell = page.getByTestId("session-editorial-shell");
		const frame = page.getByTestId("session-editorial-workspace-frame");
		const transcript = page.getByRole("region", { name: "Transcrição da sessão" });
		const editorial = page.getByRole("region", { name: "Edição editorial da sessão" });
		await expect(transcript).toBeVisible();
		await expect(page.locator(".brand")).toBeVisible();
		await expect(page.locator(".account-menu-trigger")).toBeVisible();
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth + 1,
			),
		).toBeTruthy();

		if (receipt.viewport.width > 980) {
			const move = page.getByTestId("session-campaign-move-panel");
			const [shellBox, frameBox, moveBox] = await Promise.all([
				shell.boundingBox(),
				frame.boundingBox(),
				move.boundingBox(),
			]);
			expect(shellBox).not.toBeNull();
			expect(frameBox).not.toBeNull();
			expect(moveBox).not.toBeNull();
			if (shellBox && frameBox && moveBox) {
				expect(shellBox.height).toBeLessThanOrEqual(receipt.viewport.height + 1);
				expect(frameBox.height).toBeGreaterThan(Math.max(260, receipt.viewport.height * 0.45));
				expect(moveBox.height).toBeLessThan(90);
				expect(frameBox.y).toBeGreaterThanOrEqual(moveBox.y + moveBox.height - 2);
			}
			await expect(editorial).toBeVisible();
			expect(
				await transcript.evaluate(
					(element) => element.scrollWidth <= element.clientWidth + 1,
				),
			).toBeTruthy();
			expect(
				await editorial.evaluate(
					(element) => element.scrollWidth <= element.clientWidth + 1,
				),
			).toBeTruthy();
			await expect(
				editorial.locator("footer").getByRole("button", {
					name: "Salvar draft",
					exact: true,
				}),
			).toBeVisible();
		}

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
	await expect(dialog).not.toBeVisible();
});
