import { expect, test, type Page } from "@playwright/test";

const FIXTURE = "/e2e-fixtures/transcript-revision-editor";

async function openFirstSegment(page: Page) {
	await page.getByRole("button", { name: "Editar transcrição" }).click();
	const editButton = page.getByRole("button", { name: /Editar fala de Pessoa 1 em/ }).first();
	await editButton.click();
	const speaker = page.getByRole("textbox", { name: "Pessoa desta fala" });
	const text = page.getByRole("textbox", { name: "Texto desta fala" });
	await expect(speaker).toBeVisible();
	await expect(speaker).toBeFocused();
	await expect(text).toBeVisible();
	return { speaker, text };
}

test("read mode stays progressive and save survives reload", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto(FIXTURE);

	await expect(page.getByRole("button", { name: "Editar transcrição" })).toBeVisible();
	await expect(page.getByText("Fala sintética número 1", { exact: true })).toBeVisible();

	await page.getByRole("button", { name: "Editar transcrição" }).click();
	await expect(page.locator("article")).toHaveCount(300);

	const editButton = page.getByRole("button", { name: /Editar fala de Pessoa 1 em/ }).first();
	await editButton.click();
	const speaker = page.getByRole("textbox", { name: "Pessoa desta fala" });
	const text = page.getByRole("textbox", { name: "Texto desta fala" });

	await text.fill("Alteração temporária");
	await expect(page.getByRole("button", { name: "Reverter fala" })).toBeVisible();
	await page.getByRole("button", { name: "Reverter fala" }).click();
	await expect(text).toHaveValue("Fala sintética número 1");
	await expect(page.getByRole("button", { name: "Descartar alterações" })).toHaveCount(0);

	await speaker.fill("Pessoa Revisada");
	await text.fill("Fala corrigida com café ☕");
	await expect(page.getByText("1 alterada(s)", { exact: false })).toBeVisible();
	await expect(page.getByText("Alteração não salva", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Descartar alterações" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Sair do modo de edição" })).toBeVisible();

	const search = page.getByRole("searchbox", { name: "Buscar na working copy" });
	await search.fill("café");
	await expect(page.getByText("1 ocorrência(s)", { exact: true })).toBeVisible();

	await page.keyboard.press("Control+S");
	await expect(page.getByText(/Revisão privada r2 salva/)).toBeVisible();
	await expect(page.getByRole("button", { name: "Editar transcrição" })).toBeVisible();

	await page.reload();
	await expect(page.getByText("Fala corrigida com café ☕", { exact: true })).toBeVisible();
	await expect(page.getByText("Pessoa Revisada", { exact: true })).toBeVisible();
});


test("bulk edit of 50 segments survives save and reload", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto(FIXTURE);
	await page.getByRole("button", { name: "Editar transcrição" }).click();

	for (let index = 0; index < 50; index += 1) {
		const ordinal = index + 1;
		const trackNumber = (index % 4) + 1;
		const editButton = page
			.getByRole("button", {
				name: new RegExp(`Editar fala de Pessoa ${trackNumber} em`),
			})
			.nth(Math.floor(index / 4));
		await editButton.click();
		const text = page.getByRole("textbox", { name: "Texto desta fala" });
		await text.fill(`Fala revisada em lote ${ordinal}`);
		await page.getByRole("button", { name: "Fechar fala" }).click();
	}

	await expect(page.getByText("50 alterada(s)", { exact: false })).toBeVisible();
	await page.getByRole("button", { name: "Salvar alterações da transcrição" }).click();
	await expect(page.getByText(/Revisão privada r2 salva/)).toBeVisible();

	await page.reload();
	await expect(page.getByText("Fala revisada em lote 1", { exact: true })).toBeVisible();
	await expect(page.getByText("Fala revisada em lote 50", { exact: true })).toBeVisible();
});

test("dirty navigation can be cancelled without losing the working copy", async ({ page }) => {
	await page.goto(FIXTURE);
	const { text } = await openFirstSegment(page);
	await text.fill("Rascunho que não pode sumir");

	let dialogSeen = false;
	page.once("dialog", async (dialog) => {
		dialogSeen = true;
		expect(dialog.type()).toBe("confirm");
		expect(dialog.message()).toContain("ainda não salvas");
		await dialog.dismiss();
	});
	await page.getByTestId("transcript-fixture-exit").click();

	expect(dialogSeen).toBeTruthy();
	await expect(page).toHaveURL(new RegExp("transcript-revision-editor"));
	await expect(text).toHaveValue("Rascunho que não pode sumir");
});

test("two tabs conflict without losing the stale working copy", async ({ page }) => {
	await page.goto(FIXTURE);
	const stalePage = await page.context().newPage();
	await stalePage.goto(FIXTURE);

	const primary = await openFirstSegment(page);
	await primary.text.fill("Correção salva pela primeira aba");
	await page.getByRole("button", { name: "Salvar alterações da transcrição" }).click();
	await expect(page.getByText(/Revisão privada r2 salva/)).toBeVisible();

	const stale = await openFirstSegment(stalePage);
	await stale.speaker.fill("Pessoa Concorrente");
	await stale.text.fill("Minha correção concorrente");
	await stalePage.getByRole("button", { name: "Salvar alterações da transcrição" }).click();

	await expect(stalePage.getByText(/transcrição mudou em outra edição/i)).toBeVisible();
	await expect(
		stalePage.getByRole("button", { name: "Abrir versão atual em outra aba" }),
	).toBeVisible();
	await expect(stale.speaker).toHaveValue("Pessoa Concorrente");
	await expect(stale.text).toHaveValue("Minha correção concorrente");
	await expect(
		stalePage.getByRole("button", { name: "Salvar alterações da transcrição" }),
	).toBeDisabled();
	await stalePage.close();
});

test("read-only fixture never exposes correction controls", async ({ page }) => {
	await page.goto(`${FIXTURE}?readonly=1`);
	await expect(page.getByRole("button", { name: "Editar transcrição" })).toHaveCount(0);
	await expect(page.getByText("Fala sintética número 1", { exact: true })).toBeVisible();
});

test("mobile keyboard editing stays contained and Escape closes only the active row", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto(FIXTURE);
	const { text } = await openFirstSegment(page);
	await text.fill("Correção mobile");

	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth + 1,
		),
	).toBeTruthy();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("textbox", { name: "Texto desta fala" })).toHaveCount(0);
	const reopen = page.getByRole("button", { name: "Editada · abrir" });
	await expect(reopen).toBeVisible();
	await expect(reopen).toBeFocused();
	await expect(page.getByText("1 alterada(s)", { exact: false })).toBeVisible();
});
