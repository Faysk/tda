import { expect, test } from "@playwright/test";

const PNG_1X1 = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl5n6sAAAAASUVORK5CYII=",
	"base64",
);

const PNG_10X20 = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAoAAAAUCAIAAAA7jDsBAAAAFklEQVR4nGP8z4APMOGVHZUelSZBGgCbjwEn5TWqQAAAAABJRU5ErkJggg==",
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

	await page.getByRole("button", { name: "Abrir menu global" }).click();
	const navigation = page.getByRole("navigation", { name: "Navegação principal" });
	const topLembra = navigation.getByRole("link", { name: "Lembra", exact: true });
	await expect(topLembra).toHaveAttribute("href", "/lembra");
	await expect(topLembra).toHaveAttribute("aria-current", "page");
	await page.keyboard.press("Escape");
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

	await page.getByRole("button", { name: "Ordenar referências" }).click();
	await page.getByRole("option", { name: "Nome", exact: true }).click();
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

test("Lembra desktop gives the visual library the editorial width without a permanent sidebar", async ({ page }) => {
	await page.setViewportSize({ width: 1920, height: 1080 });
	await page.goto("/lembra");

	await expect(page.getByRole("complementary", { name: "Filtros do Lembra" })).toHaveCount(0);
	const filters = page.getByRole("navigation", { name: "Filtros do Lembra" });
	await expect(filters.getByRole("button")).toHaveCount(3);

	const content = page.locator('section[aria-labelledby="lembra-title"]');
	const contentBox = await content.boundingBox();
	expect(contentBox).not.toBeNull();
	if (contentBox) expect(contentBox.width).toBeGreaterThan(1600);

	const search = page.getByPlaceholder("Buscar título, descrição, autor ou data...");
	const toolbarBox = await search.evaluate((input) =>
		input.parentElement?.parentElement?.getBoundingClientRect() ?? null,
	);
	const chrome = await page.evaluate(() => ({
		brand: document.querySelector<HTMLElement>(".brand")?.getBoundingClientRect() ?? null,
		profile: document.querySelector<HTMLElement>(".account-menu-trigger")?.getBoundingClientRect() ?? null,
	}));
	expect(toolbarBox).not.toBeNull();
	if (toolbarBox && chrome.brand && chrome.profile) {
		expect(toolbarBox.left).toBeLessThanOrEqual(chrome.brand.right + 4);
		expect(toolbarBox.right).toBeGreaterThanOrEqual(chrome.profile.left - 4);
	}

	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test("Lembra mobile sticky toolbar stays below floating global chrome", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/lembra");
	const search = page.getByPlaceholder("Buscar título, descrição, autor ou data...");
	await expect(search).toBeVisible();

	await search.evaluate((input) => {
		const spacer = document.createElement("div");
		spacer.style.height = "1600px";
		spacer.setAttribute("aria-hidden", "true");
		input.parentElement?.parentElement?.parentElement?.append(spacer);
		window.scrollTo(0, 500);
	});
	await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);

	const geometry = await search.evaluate((input) => {
		const toolbar = input.parentElement?.parentElement;
		const brand = document.querySelector<HTMLElement>(".brand")?.getBoundingClientRect();
		const trigger = document
			.querySelector<HTMLElement>(".account-menu-trigger")
			?.getBoundingClientRect();
		const box = toolbar?.getBoundingClientRect();
		return {
			toolbarTop: box?.top ?? -1,
			chromeBottom: Math.max(brand?.bottom ?? 0, trigger?.bottom ?? 0),
		};
	});
	expect(geometry.toolbarTop).toBeGreaterThanOrEqual(geometry.chromeBottom + 4);
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


test("Lembra filter popovers stay anchored, themed and dismiss on outside click", async ({ page }) => {
	await page.setViewportSize({ width: 814, height: 600 });
	await page.addInitScript(() => localStorage.setItem("tda-theme", "dark"));
	await page.goto("/lembra");

	const dateFilter = page.locator("details").filter({ hasText: "Data" });
	const dateSummary = dateFilter.locator("summary");
	await dateSummary.click();
	await expect(dateFilter).toHaveAttribute("open", "");

	const panel = dateFilter.locator("div").first();
	const summaryBox = await dateSummary.boundingBox();
	const panelBox = await panel.boundingBox();
	expect(summaryBox).not.toBeNull();
	expect(panelBox).not.toBeNull();
	expect(Math.abs((panelBox?.x ?? 0) - (summaryBox?.x ?? 0))).toBeLessThan(2);

	await page.getByPlaceholder("Buscar título, descrição, autor ou data...").click();
	await expect(dateFilter).not.toHaveAttribute("open", "");

	const sortTrigger = page.getByRole("button", { name: "Ordenar referências" });
	await sortTrigger.click();
	const listbox = page.getByRole("listbox", { name: "Ordenar referências" });
	await expect(listbox).toBeVisible();
	expect(
		await listbox.evaluate((element) => getComputedStyle(element).backgroundColor),
	).not.toBe("rgb(255, 255, 255)");

	await page.getByRole("button", { name: "Adicionar imagem" }).click();
	await expect(listbox).not.toBeVisible();
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


test("Lembra justifies desktop rows and becomes single-column at 320px", async ({ page }) => {
	await page.setViewportSize({ width: 1600, height: 900 });
	await page.goto("/lembra");
	await addReference(page, "Um", "Primeira");
	await addReference(page, "Dois", "Segunda");
	await addReference(page, "Três", "Terceira");
	await addReference(page, "Quatro", "Quarta");

	const desktopRows = page.locator("[data-gallery-row]");
	await expect(desktopRows).toHaveCount(1);
	await expect(desktopRows.first()).toHaveAttribute("data-justified", "true");

	const desktopMedia = desktopRows.first().locator("[data-gallery-media]");
	const mediaBoxes = await desktopMedia.evaluateAll((elements) =>
		elements.map((element) => {
			const box = element.getBoundingClientRect();
			return { x: box.x, y: box.y, width: box.width, height: box.height };
		}),
	);
	expect(mediaBoxes).toHaveLength(4);
	expect(
		Math.max(...mediaBoxes.map((box) => box.height)) -
			Math.min(...mediaBoxes.map((box) => box.height)),
	).toBeLessThan(1);
	expect(
		Math.max(...mediaBoxes.map((box) => box.y)) -
			Math.min(...mediaBoxes.map((box) => box.y)),
	).toBeLessThan(1);

	await page.setViewportSize({ width: 320, height: 760 });
	await expect(page.locator("[data-gallery-row]")).toHaveCount(4);
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
	await expect(titleButton).toBeVisible();
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
	expect(await cardImage.evaluate((element) => getComputedStyle(element).objectFit)).toBe("contain");
	expect(
		await cardImage.evaluate((element) => {
			const image = element as HTMLImageElement;
			return image.naturalWidth / Math.max(1, image.naturalHeight);
		}),
	).toBeCloseTo(1, 4);

	await page.getByRole("button", { name: "Quadrada", exact: true }).click();
	const viewerImage = page.getByAltText("Referência visual: Quadrada");
	await expect(viewerImage).toBeVisible();
	expect(await viewerImage.evaluate((element) => getComputedStyle(element).objectFit)).toBe("contain");
});

test("Lembra viewer fits a portrait image without cropping its source frame", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto("/lembra");
	await page.locator('input[type="file"]').setInputFiles({
		name: "vertical.png",
		mimeType: "image/png",
		buffer: PNG_10X20,
	});

	const composer = page.getByRole("dialog");
	await composer.getByLabel("Nome").fill("Vertical");
	await composer.getByRole("button", { name: "Guardar", exact: true }).click();
	await expect(composer).not.toBeVisible();

	await page.getByRole("button", { name: "Vertical", exact: true }).click();
	const viewerImage = page.getByAltText("Referência visual: Vertical");
	await expect(viewerImage).toBeVisible();

	const media = viewerImage.locator("..");
	const imageBox = await viewerImage.boundingBox();
	const mediaBox = await media.boundingBox();
	expect(imageBox).not.toBeNull();
	expect(mediaBox).not.toBeNull();

	const renderedRatio = (imageBox?.width ?? 0) / Math.max(1, imageBox?.height ?? 1);
	expect(Math.abs(renderedRatio - 0.5)).toBeLessThan(0.03);
	expect((imageBox?.width ?? 0)).toBeLessThanOrEqual((mediaBox?.width ?? 0) + 1);
	expect((imageBox?.height ?? 0)).toBeLessThanOrEqual((mediaBox?.height ?? 0) + 1);

	const imageCenter = (imageBox?.x ?? 0) + (imageBox?.width ?? 0) / 2;
	const mediaCenter = (mediaBox?.x ?? 0) + (mediaBox?.width ?? 0) / 2;
	expect(Math.abs(imageCenter - mediaCenter)).toBeLessThan(2);
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
