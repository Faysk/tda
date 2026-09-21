import { expect, test } from "@playwright/test";

const PNG_1X1 = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl5n6sAAAAASUVORK5CYII=",
	"base64",
);

async function addReference(
	page: import("@playwright/test").Page,
	title: string,
	description: string,
) {
	await page.locator('input[type="file"]').setInputFiles({
		name: `${title}.png`,
		mimeType: "image/png",
		buffer: PNG_1X1,
	});

	const dialog = page.getByRole("dialog");
	await expect(dialog.getByRole("heading", { name: "Quase lá." })).toBeVisible();
	await dialog.getByLabel("Nome").fill(title);
	await dialog.getByLabel("Descrição").fill(description);
	await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
	await expect(dialog).not.toBeVisible();
}

test("Lembra stays dense, searchable and usable from keyboard", async ({ page }) => {
	await page.goto("/lembra");

	await expect(
		page.getByPlaceholder("Buscar título, descrição, autor ou data..."),
	).toBeVisible();
	await expect(page.getByRole("button", { name: "Adicionar imagem" })).toBeVisible();
	const accessibleHeading = page.getByRole("heading", { name: "Lembra" });
	expect(
		await accessibleHeading.evaluate(
			(element) => element.getBoundingClientRect().height,
		),
	).toBeLessThanOrEqual(2);

	await addReference(page, "Alpha", "Templo de pedra");
	await addReference(page, "Zeta", "Cidade iluminada");

	await expect(page.getByRole("button", { name: "Zeta", exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Alpha", exact: true })).toBeVisible();

	const search = page.getByPlaceholder("Buscar título, descrição, autor ou data...");
	await search.fill("voce alpha");
	await expect(page.getByRole("button", { name: "Alpha", exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Zeta", exact: true })).toHaveCount(0);
	await page.getByRole("button", { name: "Limpar filtros" }).click();

	await page.getByLabel("Ordenar referências").selectOption("title");
	const titles = page.locator("article h2 button");
	await expect(titles).toHaveText(["Alpha", "Zeta"]);

	await page.getByRole("button", { name: "Alpha", exact: true }).click();
	const viewer = page.getByRole("dialog");
	await expect(viewer.getByRole("heading", { name: "Alpha" })).toBeVisible();
	await expect(viewer).toContainText("Templo de pedra");
	await expect(viewer).toContainText("Publicado por");
	await expect(viewer).toContainText("Você");

	await page.keyboard.press("ArrowRight");
	await expect(viewer.getByRole("heading", { name: "Zeta" })).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(viewer).not.toBeVisible();

	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true);
});

test("Lembra Ctrl/Cmd+K focuses search", async ({ page }) => {
	await page.goto("/lembra");
	const search = page.getByPlaceholder("Buscar título, descrição, autor ou data...");
	await page.keyboard.press(
		process.platform === "darwin" ? "Meta+k" : "Control+k",
	);
	await expect(search).toBeFocused();
});


test("Lembra lets any participant edit and remove a shared reference", async ({ page }) => {
	await page.goto("/lembra");
	await addReference(page, "Ruínas", "Primeira descrição");

	await page.getByRole("button", { name: "Ruínas", exact: true }).click();
	const viewer = page.getByRole("dialog");
	await viewer.getByRole("button", { name: "Editar", exact: true }).click();
	await viewer.getByLabel("Nome").fill("Ruínas antigas");
	await viewer.getByLabel("Descrição").fill("Descrição atualizada");
	await viewer.getByRole("button", { name: "Salvar", exact: true }).click();

	await expect(viewer.getByRole("heading", { name: "Ruínas antigas" })).toBeVisible();
	await expect(viewer).toContainText("Descrição atualizada");

	await viewer.getByRole("button", { name: "Remover", exact: true }).click();
	await expect(viewer).toContainText("Ela some do Lembra para todo mundo.");
	await expect(viewer.getByRole("button", { name: "Cancelar", exact: true })).toBeVisible();
	const removeButtons = viewer.getByRole("button", { name: "Remover", exact: true });
	await expect(removeButtons).toHaveCount(1);
	await removeButtons.click();
	await expect(viewer).not.toBeVisible();
	await expect(page.getByRole("button", { name: "Ruínas antigas", exact: true })).toHaveCount(0);
});


test("Lembra removal confirmation can be cancelled without losing context", async ({ page }) => {
	await page.goto("/lembra");
	await addReference(page, "Farol", "Costa do norte");

	await page.getByRole("button", { name: "Farol", exact: true }).click();
	const viewer = page.getByRole("dialog");
	await viewer.getByRole("button", { name: "Remover", exact: true }).click();
	await expect(viewer).toContainText("Ela some do Lembra para todo mundo.");
	await viewer.getByRole("button", { name: "Cancelar", exact: true }).click();

	await expect(viewer.getByRole("heading", { name: "Farol" })).toBeVisible();
	await expect(viewer.getByRole("button", { name: "Editar", exact: true })).toBeVisible();
	await expect(viewer).not.toContainText("Ela some do Lembra para todo mundo.");
});


test("Lembra Escape cancels editing before closing the viewer", async ({ page }) => {
	await page.goto("/lembra");
	await addReference(page, "Biblioteca", "Estantes altas");

	await page.getByRole("button", { name: "Biblioteca", exact: true }).click();
	const viewer = page.getByRole("dialog");
	await viewer.getByRole("button", { name: "Editar", exact: true }).click();
	await viewer.getByLabel("Nome").fill("Rascunho que não deve salvar");

	await page.keyboard.press("Escape");
	await expect(viewer.getByRole("heading", { name: "Biblioteca" })).toBeVisible();
	await expect(viewer.getByLabel("Nome")).toHaveCount(0);

	await page.keyboard.press("Escape");
	await expect(viewer).not.toBeVisible();
	await expect(page.getByRole("button", { name: "Biblioteca", exact: true })).toBeVisible();
});
