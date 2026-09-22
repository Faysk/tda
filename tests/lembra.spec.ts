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

	await expect(page.getByRole("link", { name: "Lembra", exact: true })).toHaveAttribute(
		"href",
		"/lembra",
	);
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
	await expect(search).toBeVisible();
	await expect(page.getByRole("button", { name: "Adicionar imagem" })).toBeEnabled();
	const shortcut =
		process.platform === "darwin" ? "Meta+KeyK" : "Control+KeyK";
	await expect
		.poll(async () => {
			await page.keyboard.press(shortcut);
			return search.evaluate((element) => document.activeElement === element);
		})
		.toBe(true);
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


test("Lembra does not keep generic clipboard filenames as searchable titles", async ({ page }) => {
	await page.goto("/lembra");
	await page.locator('input[type="file"]').setInputFiles({
		name: "image.png",
		mimeType: "image/png",
		buffer: PNG_1X1,
	});

	const dialog = page.getByRole("dialog");
	const name = dialog.getByLabel("Nome");
	await expect(name).toBeFocused();
	await expect(name).toHaveValue("");
	await expect(dialog.getByRole("button", { name: "Guardar", exact: true })).toBeVisible();
});


test("Lembra expands the gallery on desktop and stays single-column at 320px", async ({ page }) => {
	await page.setViewportSize({ width: 1600, height: 900 });
	await page.goto("/lembra");
	await addReference(page, "Um", "Primeira");
	await addReference(page, "Dois", "Segunda");
	await addReference(page, "Três", "Terceira");
	await addReference(page, "Quatro", "Quarta");

	const desktopColumns = await page.locator("article").first().evaluate((element) => {
		const grid = element.parentElement;
		if (!grid) return 0;
		return getComputedStyle(grid)
			.gridTemplateColumns.split(" ")
			.filter(Boolean).length;
	});
	expect(desktopColumns).toBeGreaterThanOrEqual(3);

	await page.setViewportSize({ width: 320, height: 760 });
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true);

	const mobileToolbarHeight = await page
		.getByPlaceholder("Buscar título, descrição, autor ou data...")
		.evaluate((input) => input.parentElement?.parentElement?.getBoundingClientRect().height ?? 999);
	expect(mobileToolbarHeight).toBeLessThanOrEqual(120);

	const cards = page.locator("article");
	const first = await cards.nth(0).boundingBox();
	const second = await cards.nth(1).boundingBox();
	expect(first).not.toBeNull();
	expect(second).not.toBeNull();
	expect(Math.abs((first?.x ?? 0) - (second?.x ?? 0))).toBeLessThan(2);
	expect((second?.y ?? 0)).toBeGreaterThan(first?.y ?? 0);
});


test("Lembra keeps very long reference names inside the mobile card", async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 760 });
	await page.goto("/lembra");
	const longTitle = "RuinaAntiga".repeat(10);
	await addReference(page, longTitle, "Descrição curta");

	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true);

	const titleButton = page.getByRole("button", { name: longTitle, exact: true });
	const box = await titleButton.boundingBox();
	expect(box).not.toBeNull();
	expect(box?.width ?? 999).toBeLessThan(280);
});


test("Lembra keeps viewer management reachable in a short desktop viewport", async ({ page }) => {
	await page.setViewportSize({ width: 1100, height: 500 });
	await page.goto("/lembra");
	await addReference(page, "Observatório", "Uma descrição suficientemente longa para ocupar espaço no painel do viewer.");

	await page.getByRole("button", { name: "Observatório", exact: true }).click();
	const viewer = page.getByRole("dialog");
	const edit = viewer.getByRole("button", { name: "Editar", exact: true });
	await edit.scrollIntoViewIfNeeded();
	await expect(edit).toBeVisible();
	await expect(viewer.getByRole("button", { name: "Fechar referência" }).last()).toBeVisible();
});


test("Lembra preserves source proportions in composer, gallery and viewer", async ({ page }) => {
	await page.goto("/lembra");
	await page.locator('input[type="file"]').setInputFiles({
		name: "quadrada.png",
		mimeType: "image/png",
		buffer: PNG_1X1,
	});

	const dialog = page.getByRole("dialog");
	const preview = dialog.getByAltText("Preview da referência selecionada");
	await expect(preview).toBeVisible();
	expect(await preview.evaluate((element) => getComputedStyle(element).objectFit)).toBe("contain");

	await dialog.getByLabel("Nome").fill("Quadrada");
	await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
	await expect(dialog).not.toBeVisible();

	const cardImage = page.locator("article").filter({ hasText: "Quadrada" }).locator("img");
	await expect(cardImage).toBeVisible();
	const cardBox = await cardImage.boundingBox();
	expect(cardBox).not.toBeNull();
	expect(Math.abs((cardBox?.width ?? 0) - (cardBox?.height ?? 0))).toBeLessThan(2);
	expect(await cardImage.evaluate((element) => getComputedStyle(element).objectFit)).toBe("contain");

	await page.getByRole("button", { name: "Quadrada", exact: true }).click();
	const viewerImage = page.getByAltText("Referência visual: Quadrada");
	await expect(viewerImage).toBeVisible();
	expect(await viewerImage.evaluate((element) => getComputedStyle(element).objectFit)).toBe("contain");
});

test("Lembra mobile viewer exposes one clear close action", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 780 });
	await page.goto("/lembra");
	await addReference(page, "Ponte", "Referência de composição");

	await page.getByRole("button", { name: "Ponte", exact: true }).click();
	const viewer = page.getByRole("dialog");
	const close = viewer.getByRole("button", { name: "Fechar referência" });
	await expect(close).toHaveCount(1);
	await close.click();
	await expect(viewer).not.toBeVisible();
});
