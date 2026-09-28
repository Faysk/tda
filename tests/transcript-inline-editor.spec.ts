import { expect, test } from "@playwright/test";

test.describe("transcript inline revision editor", () => {
	test("read -> edit -> Ctrl/Cmd+S saves a private working-copy delta", async ({
		page,
	}) => {
		await page.goto("/e2e-fixtures/transcript-editor?count=50");
		await expect(
			page.getByRole("button", { name: "Editar transcrição" }),
		).toBeVisible();
		await expect(page.locator("textarea")).toHaveCount(0);

		await page.getByRole("button", { name: "Editar transcrição" }).click();
		await page.getByRole("button", { name: "Editar fala" }).first().click();

		const group = page.getByRole("group", {
			name: "Editar fala da transcrição",
		});
		await group.getByLabel("Speaker").fill("  Alya corrigida  ");
		await group
			.getByLabel("Texto")
			.fill("  Texto corrigido com ação, ç e emoji 🦉  ");
		await group.getByLabel("Texto").press(
			process.platform === "darwin" ? "Meta+s" : "Control+s",
		);

		await expect(page.getByRole("status")).toContainText("Revisão r4 salva");
		await expect(page.getByText("Revisão privada atual · r4")).toBeVisible();
		const saved = JSON.parse(
			(await page.getByTestId("last-save").textContent()) ?? "{}",
		);
		expect(saved.expectedCurrentTranscriptRevisionId).toBe(
			"33333333-3333-4333-8333-333333333333",
		);
		expect(saved.changeCount).toBe(1);
		expect(saved.changes).toEqual([
			{
				segmentKey: "r-1-seg-0",
				speaker: "Alya corrigida",
				text: "Texto corrigido com ação, ç e emoji 🦉",
			},
		]);
		expect(saved.changes[0]).not.toHaveProperty("startMs");
		expect(saved.changes[0]).not.toHaveProperty("endMs");

		await page.getByRole("searchbox", { name: "Buscar fala ou speaker" }).fill(
			"corrigido",
		);
		await expect(page.getByText("1 resultado(s)")).toBeVisible();
	});

	test("revert and dirty-navigation guard preserve user control", async ({ page }) => {
		await page.goto("/e2e-fixtures/transcript-editor?count=12");
		await page.getByRole("button", { name: "Editar transcrição" }).click();
		await page.getByRole("button", { name: "Editar fala" }).first().click();
		const group = page.getByRole("group", {
			name: "Editar fala da transcrição",
		});
		await group.getByLabel("Texto").fill("Working copy local");
		await page.getByRole("button", { name: "Concluir fala" }).click();

		await expect(page.getByText("Editada", { exact: true })).toBeVisible();
		await expect(page.getByText("1 fala(s) alterada(s)")).toBeVisible();
		await page.getByRole("button", { name: "Reverter fala" }).click();
		await expect(page.getByText("Editada", { exact: true })).toHaveCount(0);
		await expect(page.getByText("0 fala(s) alterada(s)")).toBeVisible();

		await page.getByRole("button", { name: "Editar fala" }).first().click();
		await page
			.getByRole("group", { name: "Editar fala da transcrição" })
			.getByLabel("Texto")
			.fill("Não quero perder isto");
		await page.getByRole("button", { name: "Concluir fala" }).click();

		page.once("dialog", async (dialog) => {
			expect(dialog.message()).toContain("alterações não salvas");
			await dialog.dismiss();
		});
		await page.getByRole("link", { name: "Sair da fixture" }).click();
		await expect(page).toHaveURL(/count=12/u);
		await expect(page.getByText("Editada", { exact: true })).toBeVisible();
	});

	test("stale save keeps the working copy and offers explicit reconciliation", async ({
		page,
	}) => {
		await page.goto(
			"/e2e-fixtures/transcript-editor?count=8&mode=conflict",
		);
		await page.getByRole("button", { name: "Editar transcrição" }).click();
		await page.getByRole("button", { name: "Editar fala" }).first().click();
		await page
			.getByRole("group", { name: "Editar fala da transcrição" })
			.getByLabel("Texto")
			.fill("Minha alteração concorrente");
		await page.getByRole("button", { name: "Concluir fala" }).click();
		await page.getByRole("button", { name: "Salvar nova revisão" }).click();

		const alert = page.getByRole("alert");
		await expect(alert).toContainText("working copy continua nesta aba");
		await expect(page.getByText("Editada", { exact: true })).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Abrir versão atual em nova aba" }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Recarregar e descartar" }),
		).toBeVisible();
	});

	test("read-only and 7,500-segment fixtures stay progressive and mobile-safe", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto(
			"/e2e-fixtures/transcript-editor?count=7500&editable=0",
		);
		await expect(
			page.getByRole("button", { name: "Editar transcrição" }),
		).toHaveCount(0);
		await expect(page.locator(".inlineEditor textarea")).toHaveCount(0);
		expect(await page.locator("[data-transcript-segment]").count()).toBeLessThan(
			7_500,
		);
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth + 1,
			),
		).toBe(true);

		await page.goto("/e2e-fixtures/transcript-editor?count=7500");
		await page.getByRole("button", { name: "Editar transcrição" }).click();
		await expect(page.locator("textarea")).toHaveCount(0);
		await page.getByRole("button", { name: "Editar fala" }).first().click();
		await expect(page.locator("textarea")).toHaveCount(1);
		expect(await page.locator("[data-transcript-segment]").count()).toBeLessThan(
			7_500,
		);
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth + 1,
			),
		).toBe(true);
	});

	test("backend failure preserves the dirty working copy", async ({ page }) => {
		await page.goto(
			"/e2e-fixtures/transcript-editor?count=4&mode=unavailable",
		);
		await page.getByRole("button", { name: "Editar transcrição" }).click();
		await page.getByRole("button", { name: "Editar fala" }).first().click();
		await page
			.getByRole("group", { name: "Editar fala da transcrição" })
			.getByLabel("Texto")
			.fill("Persistir depois");
		await page.getByRole("button", { name: "Concluir fala" }).click();
		await page.getByRole("button", { name: "Salvar nova revisão" }).click();
		await expect(page.getByRole("alert")).toContainText(
			"working copy foi preservada",
		);
		await expect(page.getByText("Editada", { exact: true })).toBeVisible();
	});
});
