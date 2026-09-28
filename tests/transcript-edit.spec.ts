import { expect, test, type Page } from "@playwright/test";

async function openFresh(page: Page) {
	await page.goto("/e2e-fixtures/transcript-edit?reset=1");
	await expect(
		page.getByRole("heading", { name: "Transcript Edit E2E" }),
	).toBeVisible();
}

async function editFirst(
	page: Page,
	text: string,
	speaker = "Álya editada",
) {
	const enterEditMode = page.getByRole("button", {
		name: "Editar transcrição",
		exact: true,
	});
	if (await enterEditMode.isVisible().catch(() => false)) await enterEditMode.click();
	const first = page.locator("[data-transcript-segment]").first();
	await first.getByRole("button", { name: "Editar fala" }).click();
	await first.getByLabel("Speaker").fill(speaker);
	await first.getByLabel("Texto da fala").fill(text);
	await first
		.getByRole("button", { name: "Concluir edição da fala" })
		.click();
	return first;
}

test("edits speaker/text, searches the working copy, saves a new revision and survives reload", async ({
	page,
}) => {
	await openFresh(page);
	expect(await page.locator("[data-transcript-segment]").count()).toBeLessThanOrEqual(
		300,
	);
	expect(await page.locator("textarea").count()).toBe(0);

	const first = await editFirst(page, "Fala corrigida com coração 🌲");
	await expect(first.getByText("Editada", { exact: true })).toBeVisible();
	await page.getByLabel("Buscar fala ou speaker").fill("coração");
	await expect(page.getByText("1 resultado(s)", { exact: true })).toBeVisible();
	await expect(first.getByRole("button", { name: "00:00:00" })).toBeVisible();

	await page
		.getByRole("button", { name: "Salvar alterações da transcrição" })
		.click();
	await expect(
		page.getByText("Revisão privada r2 salva.", { exact: true }),
	).toBeVisible();
	await expect(
		page.getByText("Revisão privada atual · r2", { exact: true }),
	).toBeVisible();

	await page.reload();
	await expect(
		page.getByText("Fala corrigida com coração 🌲", { exact: true }),
	).toBeVisible();
	await expect(page.getByText("Álya editada", { exact: true })).toBeVisible();
	await expect(
		page.getByText("Revisão privada sintética · r2", { exact: true }),
	).toBeVisible();
});

test("copies the visible working speaker in a timestamp reference before save", async ({
	page,
	context,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"], {
		origin: "http://127.0.0.1:3112",
	});
	await openFresh(page);
	const first = await editFirst(
		page,
		"Texto permanece apenas na working copy",
		"Speaker em revisão",
	);

	await first.getByRole("button", { name: "00:00:00" }).click();
	await expect
		.poll(() => page.evaluate(() => navigator.clipboard.readText()))
		.toBe("00:00:00.000 · Speaker em revisão");

	await first.getByRole("button", { name: "Reverter" }).click();
	await first.getByRole("button", { name: "00:00:00" }).click();
	await expect
		.poll(() => page.evaluate(() => navigator.clipboard.readText()))
		.toBe("00:00:00.000 · Speaker 1");
});

test("revert removes dirty state and dirty navigation requires explicit confirmation", async ({
	page,
}) => {
	await openFresh(page);
	const first = await editFirst(page, "Mudança descartável");
	await first.getByRole("button", { name: "Reverter" }).click();
	await expect(page.getByText("Nenhuma alteração", { exact: true })).toBeVisible();

	await editFirst(page, "Working copy protegida");
	page.once("dialog", async (dialog) => {
		expect(dialog.message()).toContain("alterações não salvas");
		await dialog.dismiss();
	});
	await page.getByRole("link", { name: "Sair da fixture" }).click();
	await expect(page).toHaveURL(/\/e2e-fixtures\/transcript-edit/u);
	await expect(
		page.getByText("Working copy protegida", { exact: true }),
	).toBeVisible();
});

test("stale current preserves the working copy and never retries blindly", async ({
	page,
}) => {
	await openFresh(page);
	await editFirst(page, "Minha correção local");
	await page.getByRole("button", { name: "Simular revisão remota" }).click();
	await expect(page.getByTestId("remote-revision")).toHaveText("2");

	await page
		.getByRole("button", { name: "Salvar alterações da transcrição" })
		.click();
	const readerAlert = page
		.getByRole("region", { name: "Leitor e editor de transcrição" })
		.getByRole("alert");
	await expect(readerAlert).toContainText("working copy foi preservada");
	await expect(readerAlert).toContainText("Remoto: r2");
	await expect(
		page.getByText("Minha correção local", { exact: true }),
	).toBeVisible();
	await expect(
		page.getByText("1 alteração(ões) não salvas", { exact: true }),
	).toBeVisible();
});

test("ambiguous response reuses the operation and reconciles without a duplicate revision", async ({
	page,
}) => {
	await openFresh(page);
	await editFirst(page, "Commit com resposta perdida");
	await page
		.getByRole("button", { name: "Perder próxima resposta de save" })
		.click();
	await expect(page.getByTestId("lost-response-armed")).toHaveText("armed");

	await page
		.getByRole("button", { name: "Salvar alterações da transcrição" })
		.click();
	await expect(
		page
			.getByRole("region", { name: "Leitor e editor de transcrição" })
			.getByRole("alert"),
	).toContainText("Não foi possível confirmar o save");
	await page
		.getByRole("button", { name: "Salvar alterações da transcrição" })
		.click();
	await expect(
		page.getByText("Revisão privada r2 salva.", { exact: true }),
	).toBeVisible();

	await page.reload();
	await expect(
		page.getByText("Commit com resposta perdida", { exact: true }),
	).toBeVisible();
	await expect(
		page.getByText("Revisão privada sintética · r2", { exact: true }),
	).toBeVisible();
});

test("saves fifty edited utterances in one explicit revision", async ({ page }) => {
	await openFresh(page);
	await page.getByRole("button", { name: "Editar transcrição" }).click();
	const rows = page.locator("[data-transcript-segment]");

	for (let index = 0; index < 50; index += 1) {
		const row = rows.nth(index);
		await row.getByRole("button", { name: "Editar fala" }).click();
		await row
			.getByLabel("Texto da fala")
			.fill(`Correção em lote ${index + 1} 🌲`);
		await row
			.getByRole("button", { name: "Concluir edição da fala" })
			.click();
	}

	await expect(
		page.getByText("50 alteração(ões) não salvas", { exact: true }),
	).toBeVisible();
	await page
		.getByRole("button", { name: "Salvar alterações da transcrição" })
		.click();
	await expect(
		page.getByText("Revisão privada r2 salva.", { exact: true }),
	).toBeVisible();

	await page.reload();
	await expect(page.getByText("Correção em lote 1 🌲", { exact: true })).toBeVisible();
	await expect(page.getByText("Correção em lote 50 🌲", { exact: true })).toBeVisible();
});

test("two tabs enforce current-revision CAS and preserve the losing working copy", async ({
	page,
	context,
}) => {
	await openFresh(page);
	const other = await context.newPage();
	await other.goto("/e2e-fixtures/transcript-edit");
	await expect(
		other.getByRole("heading", { name: "Transcript Edit E2E" }),
	).toBeVisible();

	await editFirst(page, "Correção vencedora da aba A");
	await editFirst(other, "Correção concorrente da aba B");

	await page
		.getByRole("button", { name: "Salvar alterações da transcrição" })
		.click();
	await expect(
		page.getByText("Revisão privada r2 salva.", { exact: true }),
	).toBeVisible();

	await other
		.getByRole("button", { name: "Salvar alterações da transcrição" })
		.click();
	const otherReaderAlert = other
		.getByRole("region", { name: "Leitor e editor de transcrição" })
		.getByRole("alert");
	await expect(otherReaderAlert).toContainText("working copy foi preservada");
	await expect(otherReaderAlert).toContainText("Remoto: r2");
	await expect(
		other.getByText("Correção concorrente da aba B", { exact: true }),
	).toBeVisible();
	await expect(
		other.getByText("1 alteração(ões) não salvas", { exact: true }),
	).toBeVisible();
	await other.close();
});

test("read-only and mobile states remain contained and keyboard editing is operable", async ({
	page,
}) => {
	await openFresh(page);
	await page.getByLabel("Permitir edição").uncheck();
	await expect(
		page.getByRole("button", { name: "Editar transcrição" }),
	).toHaveCount(0);

	await page.getByLabel("Permitir edição").check();
	await page.getByRole("button", { name: "Editar transcrição" }).focus();
	await page.keyboard.press("Enter");
	const first = page.locator("[data-transcript-segment]").first();
	await first.getByRole("button", { name: "Editar fala" }).focus();
	await page.keyboard.press("Enter");
	await expect(first.getByLabel("Speaker")).toBeFocused();
	await first.getByLabel("Texto da fala").fill("Salvo pelo teclado");
	await first
		.getByRole("button", { name: "Concluir edição da fala" })
		.click();
	await expect(
		page.getByText("1 alteração(ões) não salvas", { exact: true }),
	).toBeVisible();
	await page.keyboard.press("Control+KeyS");
	await expect(
		page.getByText("Revisão privada r2 salva.", { exact: true }),
	).toBeVisible();

	await page.setViewportSize({ width: 390, height: 844 });
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth + 1,
		),
	).toBeTruthy();
	expect(await page.locator("textarea").count()).toBeLessThanOrEqual(1);
});
