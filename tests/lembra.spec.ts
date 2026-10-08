import { expect, test } from "@playwright/test";
import { selectThemedOption } from "./helpers/themed-select";

const PNG_1X1 = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl5n6sAAAAASUVORK5CYII=",
	"base64",
);

const PNG_10X20 = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAoAAAAUCAIAAAA7jDsBAAAAFklEQVR4nGP8z4APMOGVHZUelSZBGgCbjwEn5TWqQAAAAABJRU5ErkJggg==",
	"base64",
);

const LONG_CAMPAIGN = "Expedição pelos Confins do Reino das Estrelas Cadentes";

async function expectReadableControlText(
	locator: import("@playwright/test").Locator,
	viewportWidth: number,
) {
	const metrics = await locator.evaluate((element) => {
		const target = element.querySelector("span") ?? element;
		const box = target.getBoundingClientRect();
		const style = getComputedStyle(target);
		return {
			left: box.left,
			right: box.right,
			scrollWidth: target.scrollWidth,
			clientWidth: target.clientWidth,
			scrollHeight: target.scrollHeight,
			clientHeight: target.clientHeight,
			whiteSpace: style.whiteSpace,
			textOverflow: style.textOverflow,
		};
	});
	expect(metrics.left).toBeGreaterThanOrEqual(-1);
	expect(metrics.right).toBeLessThanOrEqual(viewportWidth + 1);
	expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
	expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 1);
	return metrics;
}

async function addReference(
	page: import("@playwright/test").Page,
	title: string,
	description: string,
) {
	const fileChooserPromise = page.waitForEvent("filechooser");
	await page.getByRole("button", { name: "Adicionar imagem" }).click();
	const fileChooser = await fileChooserPromise;
	await fileChooser.setFiles({
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


test("Lembra private campaign projection is visible only to an authorized viewer", async ({ page }) => {
	await page.goto("/e2e-fixtures/lembra-campaigns");

	const privateCard = page.locator("article").filter({ hasText: "Referência privada global" });
	await expect(privateCard).toContainText("Passos Retomados");
	const campaignFilter = page.getByRole("button", { name: "Filtrar por campanha" });
	await campaignFilter.click();
	await expect(page.getByRole("option", { name: "Passos Retomados", exact: true })).toBeVisible();
	await page.keyboard.press("Escape");

	await page.goto("/e2e-fixtures/lembra-campaigns?private=0");
	const outsiderCard = page.locator("article").filter({ hasText: "Referência privada global" });
	await expect(outsiderCard).toBeVisible();
	await expect(outsiderCard).not.toContainText("Passos Retomados");

	const rawHtml = await page.content();
	expect(rawHtml).not.toContain("Passos Retomados");
	expect(rawHtml).not.toContain("66666666-6666-4666-8666-666666666666");

	const outsiderFilter = page.getByRole("button", { name: "Filtrar por campanha" });
	await outsiderFilter.click();
	await expect(page.getByRole("option", { name: "Passos Retomados", exact: true })).toHaveCount(0);
	await page.keyboard.press("Escape");

	const search = page.getByPlaceholder("Buscar título, descrição, autor ou data...");
	await search.fill("passos retomados");
	await expect(outsiderCard).toHaveCount(0);
});

test("Lembra campaign classification stays optional, filterable and non-authoritative", async ({ page }) => {
	await page.goto("/e2e-fixtures/lembra-campaigns");

	const campaignFilter = page.getByRole("button", { name: "Filtrar por campanha" });
	await expect(campaignFilter).toBeVisible();

	await campaignFilter.click();
	await page.getByRole("option", { name: "Geral", exact: true }).click();
	await expect(page.getByRole("button", { name: "Geral", exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Mesa", exact: true })).toHaveCount(0);

	await campaignFilter.click();
	await page.getByRole("option", { name: "Crônicas da Mesa", exact: true }).click();
	await expect(page.getByRole("button", { name: "Mesa", exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Geral", exact: true })).toHaveCount(0);

	await page.getByRole("button", { name: "Limpar filtros" }).click();
	const search = page.getByPlaceholder(
		"Buscar título, descrição, autor ou data...",
	);
	await search.fill("campanha arquivada");
	await expect(page.getByRole("button", { name: "Histórica", exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Mesa", exact: true })).toHaveCount(0);
	await page.getByRole("button", { name: "Limpar filtros" }).click();

	await page.getByRole("button", { name: "Histórica", exact: true }).click();
	const viewer = page.getByRole("dialog");
	await expect(viewer).toContainText("Campanha Arquivada · arquivada");
	await viewer.getByRole("button", { name: "Editar", exact: true }).click();
	await viewer.getByRole("button", { name: "Campanha da referência" }).click();
	await expect(
		page.getByRole("option", { name: "Campanha Arquivada · arquivada", exact: true }),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await viewer.getByRole("button", { name: "Fechar referência" }).click();

	await page.locator('input[type="file"]').setInputFiles({
		name: "nova-referencia.png",
		mimeType: "image/png",
		buffer: PNG_1X1,
	});
	const composer = page.getByRole("dialog");
	await expect(composer.getByRole("heading", { name: "Quase lá." })).toBeVisible();
	await composer.getByRole("button", { name: "Campanha da referência" }).click();
	await expect(
		page.getByRole("option", { name: "Campanha Arquivada · arquivada", exact: true }),
	).toHaveCount(0);
	await page.getByRole("option", { name: "Campanha Pública B", exact: true }).click();
	await expect(
		composer.getByRole("button", { name: "Campanha da referência" }),
	).toContainText("Campanha Pública B");
});




test("Lembra keeps campaign identity and sort choices readable across mobile and zoom reflow", async ({ page }, testInfo) => {
	for (const viewport of [
		{ width: 320, height: 760 },
		{ width: 390, height: 844 },
		{ width: 683, height: 384 },
		{ width: 1366, height: 768 },
	]) {
		await page.setViewportSize(viewport);
		await page.goto("/e2e-fixtures/lembra-campaigns");
		const campaignFilter = page.getByRole("button", { name: "Filtrar por campanha" });
		await campaignFilter.click();
		const longOption = page.getByRole("option", { name: LONG_CAMPAIGN, exact: true });
		await expect(longOption).toBeVisible();
		await expectReadableControlText(longOption, viewport.width);
		await longOption.click();
		await expect(campaignFilter).toContainText(LONG_CAMPAIGN);
		const active = await expectReadableControlText(campaignFilter, viewport.width);
		expect(active.whiteSpace).not.toBe("nowrap");
		await expect(page.getByRole("button", { name: "Confins", exact: true })).toBeVisible();
		const sort = page.getByRole("button", { name: "Ordenar referências" });
		await sort.click();
		for (const label of ["Mais recentes", "Mais antigas", "Nome", "Autor"]) {
			const option = page.getByRole("option", { name: label, exact: true });
			await expect(option).toBeVisible();
			await expectReadableControlText(option, viewport.width);
		}
		await page.keyboard.press("Escape");
		await expect(sort).toBeFocused();
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
		const receipt = testInfo.outputPath(`lembra-filter-${viewport.width}x${viewport.height}.png`);
		await page.screenshot({ path: receipt, fullPage: false });
		await testInfo.attach(`lembra-filter-${viewport.width}x${viewport.height}`, { path: receipt, contentType: "image/png" });
	}
});

test("Lembra returns to Geral and cancels campaign creation without changing the upload draft", async ({ page }) => {
	await page.goto("/e2e-fixtures/lembra-campaigns");
	await page.locator('input[type="file"]').setInputFiles({
		name: "cancel-safe-draft.png",
		mimeType: "image/png",
		buffer: PNG_1X1,
	});

	const composer = page
		.getByRole("dialog")
		.filter({ has: page.getByRole("heading", { name: "Quase lá." }) });
	await composer.getByLabel("Nome").fill("Rascunho cancelável");
	await composer.getByLabel("Descrição").fill("Nada daqui pode sumir ao cancelar.");
	const preview = composer.getByAltText("Preview da referência selecionada");
	const previewUrl = await preview.getAttribute("src");
	const campaignPicker = composer.getByRole("button", { name: "Campanha da referência" });

	await campaignPicker.click();
	await page.getByRole("option", { name: "Campanha Pública B", exact: true }).click();
	await expect(campaignPicker).toContainText("Campanha Pública B");

	await campaignPicker.click();
	await page.getByRole("option", { name: "Geral", exact: true }).click();
	await expect(campaignPicker).toContainText("Geral");

	const createTrigger = composer.getByRole("button", { name: "Nova campanha" });
	await createTrigger.click();
	const createDialog = page.getByRole("dialog", { name: "Criar campanha" });
	await createDialog.getByLabel("Nome").fill("Campanha descartada");
	await createDialog.getByLabel("Slug técnico").fill("campanha-descartada");
	await createDialog.getByLabel("Rota pública").fill("campanha-descartada");
	await createDialog.getByRole("button", { name: "Cancelar", exact: true }).click();

	await expect(createDialog).not.toBeVisible();
	await expect(composer).toBeVisible();
	await expect(composer.getByLabel("Nome")).toHaveValue("Rascunho cancelável");
	await expect(composer.getByLabel("Descrição")).toHaveValue("Nada daqui pode sumir ao cancelar.");
	await expect(preview).toHaveAttribute("src", previewUrl ?? "");
	await expect(campaignPicker).toContainText("Geral");
	await expect(createTrigger).toBeFocused();
});

test("Lembra creates a public campaign in context without losing the upload draft", async ({ page }) => {
	await page.goto("/e2e-fixtures/lembra-campaigns");
	await page.locator('input[type="file"]').setInputFiles({
		name: "draft-preservado.png",
		mimeType: "image/png",
		buffer: PNG_1X1,
	});

	const composer = page
		.getByRole("dialog")
		.filter({ has: page.getByRole("heading", { name: "Quase lá." }) });
	await composer.getByLabel("Nome").fill("Rascunho preservado");
	await composer.getByLabel("Descrição").fill("Não pode sumir no abre e fecha.");
	const preview = composer.getByAltText("Preview da referência selecionada");
	const previewUrl = await preview.getAttribute("src");

	const createTrigger = composer.getByRole("button", { name: "Nova campanha" });
	await expect(createTrigger).toBeVisible();
	const manageLink = composer.getByRole("link", { name: /Gerenciar campanhas/ });
	await expect(manageLink).toHaveAttribute("target", "_blank");
	await expect(manageLink).toHaveAttribute("href", "/edit/campanhas");

	await createTrigger.click();
	const createDialog = page.getByRole("dialog", { name: "Criar campanha" });
	await expect(createDialog).toBeVisible();
	await expect(createDialog.getByLabel("Nome")).toBeFocused();
	await createDialog.getByLabel("Nome").fill("Aurora Pública");
	await createDialog.getByLabel("Slug técnico").fill("aurora-publica");
	await createDialog.getByLabel("Rota pública").fill("aurora-publica");
	await createDialog.getByLabel("Descrição").fill("Campanha criada dentro do Lembra.");
	await createDialog.getByRole("button", { name: "Criar e voltar" }).click();

	await expect(createDialog).not.toBeVisible();
	await expect(composer).toBeVisible();
	await expect(composer.getByLabel("Nome")).toHaveValue("Rascunho preservado");
	await expect(composer.getByLabel("Descrição")).toHaveValue("Não pode sumir no abre e fecha.");
	await expect(preview).toHaveAttribute("src", previewUrl ?? "");
	await expect(composer.getByRole("button", { name: "Campanha da referência" })).toContainText(
		"Aurora Pública",
	);
	await expect(composer).toContainText("Campanha criada e selecionada.");

	await composer.getByRole("button", { name: "Guardar", exact: true }).click();
	await expect(composer).not.toBeVisible();
	const card = page.locator("article").filter({ hasText: "Rascunho preservado" });
	await expect(card).toContainText("Aurora Pública · Por Você");
});

test("Lembra selects a newly created private campaign only after authorized projection confirms it", async ({ page }) => {
	await page.goto("/e2e-fixtures/lembra-campaigns");
	await page.locator('input[type="file"]').setInputFiles({
		name: "private-draft.png",
		mimeType: "image/png",
		buffer: PNG_1X1,
	});

	const composer = page
		.getByRole("dialog")
		.filter({ has: page.getByRole("heading", { name: "Quase lá." }) });
	await composer.getByLabel("Nome").fill("Rascunho privado");
	await composer.getByLabel("Descrição").fill("Seleção anterior precisa continuar.");
	const preview = composer.getByAltText("Preview da referência selecionada");
	const previewUrl = await preview.getAttribute("src");

	await composer.getByRole("button", { name: "Nova campanha" }).click();
	const createDialog = page.getByRole("dialog", { name: "Criar campanha" });
	await createDialog.getByLabel("Nome").fill("Segredo da Mesa");
	await createDialog.getByLabel("Slug técnico").fill("segredo-da-mesa");
	await createDialog.getByLabel("Rota pública").fill("segredo-da-mesa");
	await selectThemedOption(
		page,
		createDialog.getByRole("button", { name: "Visibilidade inicial" }),
		"private",
	);
	await createDialog.getByRole("button", { name: "Criar e voltar" }).click();

	await expect(createDialog).not.toBeVisible();
	await expect(composer.getByLabel("Nome")).toHaveValue("Rascunho privado");
	await expect(composer.getByLabel("Descrição")).toHaveValue("Seleção anterior precisa continuar.");
	await expect(preview).toHaveAttribute("src", previewUrl ?? "");
	await expect(composer.getByRole("button", { name: "Campanha da referência" })).toContainText(
		"Segredo da Mesa",
	);
	await expect(composer).toContainText("Campanha criada e selecionada.");

	await composer.getByRole("button", { name: "Guardar", exact: true }).click();
	await expect(composer).not.toBeVisible();
	const privateCard = page.locator("article").filter({ hasText: "Rascunho privado" });
	await expect(privateCard).toContainText("Segredo da Mesa · Por Você");

	const campaignFilter = page.getByRole("button", { name: "Filtrar por campanha" });
	await campaignFilter.click();
	await page.getByRole("option", { name: "Segredo da Mesa", exact: true }).click();
	await expect(privateCard).toBeVisible();

	await page.getByRole("button", { name: "Limpar filtros" }).click();
	const search = page.getByPlaceholder("Buscar título, descrição, autor ou data...");
	await search.fill("segredo da mesa");
	await expect(privateCard).toBeVisible();
	await page.getByRole("button", { name: "Limpar filtros" }).click();

	await page.getByRole("button", { name: "Rascunho privado", exact: true }).click();
	const viewer = page.getByRole("dialog");
	await viewer.getByRole("button", { name: "Editar", exact: true }).click();
	await viewer.getByRole("button", { name: "Campanha da referência" }).click();
	await page.getByRole("option", { name: "Geral", exact: true }).click();
	await viewer.getByRole("button", { name: "Salvar", exact: true }).click();
	await expect(viewer).toContainText("Geral");
});

test("Lembra campaign creation keeps the overlay open on conflict or dependency failure", async ({ page }) => {
	await page.goto("/e2e-fixtures/lembra-campaigns");
	await page.locator('input[type="file"]').setInputFiles({
		name: "error-draft.png",
		mimeType: "image/png",
		buffer: PNG_1X1,
	});

	const composer = page
		.getByRole("dialog")
		.filter({ has: page.getByRole("heading", { name: "Quase lá." }) });
	await composer.getByLabel("Nome").fill("Rascunho ainda aqui");
	const previewUrl = await composer
		.getByAltText("Preview da referência selecionada")
		.getAttribute("src");
	const createTrigger = composer.getByRole("button", { name: "Nova campanha" });
	await createTrigger.click();

	const createDialog = page.getByRole("dialog", { name: "Criar campanha" });
	await createDialog.getByLabel("Nome").fill("X");
	await createDialog.getByLabel("Slug técnico").fill("valid-campaign");
	await createDialog.getByLabel("Rota pública").fill("valid-campaign");
	await createDialog.getByRole("button", { name: "Criar e voltar" }).click();
	await expect(createDialog.getByLabel("Nome")).toHaveAttribute("aria-invalid", "true");
	await expect(createDialog.getByText("Informe um nome entre 2 e 120 caracteres.")).toBeVisible();

	await createDialog.getByLabel("Nome").fill("Campanha em conflito");
	await createDialog.getByLabel("Slug técnico").fill("existing-campaign");
	await createDialog.getByLabel("Rota pública").fill("existing-campaign");
	await createDialog.getByRole("button", { name: "Criar e voltar" }).click();
	await expect(createDialog).toBeVisible();
	await expect(createDialog.getByRole("alert")).toContainText("Já existe uma campanha");

	await createDialog.getByLabel("Slug técnico").fill("dependency-down");
	await createDialog.getByLabel("Rota pública").fill("dependency-down");
	await createDialog.getByRole("button", { name: "Criar e voltar" }).click();
	await expect(createDialog).toBeVisible();
	await expect(createDialog.getByRole("alert")).toContainText("temporariamente indisponível");

	await page.keyboard.press("Escape");
	await expect(createDialog).not.toBeVisible();
	await expect(composer).toBeVisible();
	await expect(composer.getByLabel("Nome")).toHaveValue("Rascunho ainda aqui");
	await expect(composer.getByAltText("Preview da referência selecionada")).toHaveAttribute(
		"src",
		previewUrl ?? "",
	);
	await expect(createTrigger).toBeFocused();
});

test("Lembra hides campaign management entrypoints without project capability", async ({ page }) => {
	await page.goto("/e2e-fixtures/lembra-campaigns?manage=0");
	await page.locator('input[type="file"]').setInputFiles({
		name: "sem-capability.png",
		mimeType: "image/png",
		buffer: PNG_1X1,
	});

	const composer = page
		.getByRole("dialog")
		.filter({ has: page.getByRole("heading", { name: "Quase lá." }) });
	await expect(composer.getByRole("button", { name: "Nova campanha" })).toHaveCount(0);
	await expect(composer.getByRole("link", { name: /Gerenciar campanhas/ })).toHaveCount(0);
	await composer.getByRole("button", { name: "Campanha da referência" }).click();
	await page.getByRole("option", { name: "Crônicas da Mesa", exact: true }).click();
	await expect(composer.getByRole("button", { name: "Campanha da referência" })).toContainText(
		"Crônicas da Mesa",
	);
});

test("Lembra contextual campaign dialogs reflow at 320px and a 200%-equivalent viewport", async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 760 });
	await page.goto("/e2e-fixtures/lembra-campaigns");
	await page.locator('input[type="file"]').setInputFiles({
		name: "mobile-draft.png",
		mimeType: "image/png",
		buffer: PNG_1X1,
	});

	const composer = page
		.getByRole("dialog")
		.filter({ has: page.getByRole("heading", { name: "Quase lá." }) });
	await composer.getByRole("button", { name: "Nova campanha" }).click();
	await expect(page.getByRole("dialog", { name: "Criar campanha" })).toBeVisible();

	expect(
		await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
	).toBe(true);

	await page.setViewportSize({ width: 683, height: 384 });
	await expect(page.getByRole("dialog", { name: "Criar campanha" })).toBeVisible();
	expect(
		await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
	).toBe(true);
});

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
	await addReference(page, "Cinco", "Quinta");

	const desktopRows = page.locator("[data-gallery-row]");
	await expect(desktopRows).toHaveCount(2);
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
	await expect(page.locator("[data-gallery-row]")).toHaveCount(5);
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true);

	const mobileToolbarHeight = await page
		.getByPlaceholder("Buscar título, descrição, autor ou data...")
		.evaluate((input) => input.parentElement?.parentElement?.getBoundingClientRect().height ?? 999);
	expect(mobileToolbarHeight).toBeLessThanOrEqual(180);
	await expect(page.getByRole("button", { name: "Filtrar por campanha" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Ordenar referências" })).toBeVisible();

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
	await expect.poll(async () => (await titleButton.boundingBox())?.width ?? 0).toBeGreaterThan(0);
	const box = await titleButton.boundingBox();
	expect(box?.width ?? 999).toBeLessThan(280);
	await titleButton.focus();
	await expect(titleButton).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(page.getByRole("dialog").getByRole("heading", { name: longTitle, exact: true })).toBeVisible();
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
	const chooserEvent = page.waitForEvent("filechooser");
	await page.getByRole("button", { name: "Adicionar imagem" }).click();
	const chooser = await chooserEvent;
	await chooser.setFiles({
		name: "quadrada.png",
		mimeType: "image/png",
		buffer: PNG_1X1,
	});

	const dialog = page.getByRole("dialog");
	const preview = dialog.getByAltText("Preview da referência selecionada");
	await expect(preview).toBeVisible();
	await expect(preview).toHaveCSS("object-fit", "contain");

	await dialog.getByLabel("Nome").fill("Quadrada");
	await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
	await expect(dialog).not.toBeVisible();

	const cardImage = page.locator("article").filter({ hasText: "Quadrada" }).locator("img");
	await expect(cardImage).toBeVisible();
	await expect(cardImage).toHaveCSS("object-fit", "contain");
	expect(
		await cardImage.evaluate((element) => {
			const image = element as HTMLImageElement;
			return image.naturalWidth / Math.max(1, image.naturalHeight);
		}),
	).toBeCloseTo(1, 4);

	await page.getByRole("button", { name: "Quadrada", exact: true }).click();
	const viewerImage = page.getByAltText("Referência visual: Quadrada");
	await expect(viewerImage).toBeVisible();
	await expect(viewerImage).toHaveCSS("object-fit", "contain");
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


test("Lembra lets the visual library own the desktop viewport", async ({ page }) => {
	await page.setViewportSize({ width: 1920, height: 1080 });
	await page.goto("/lembra");

	const filters = page.getByRole("navigation", { name: "Filtros do Lembra" });
	await expect(filters).toBeVisible();
	await expect(page.locator('aside[aria-label="Filtros do Lembra"]')).toHaveCount(0);
	await expect(filters.getByRole("button", { name: /Lembra/ })).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await expect(filters.getByRole("button", { name: /Meus itens/ })).toHaveAttribute(
		"aria-pressed",
		"false",
	);
	await expect(filters.getByRole("button", { name: /Favoritos/ })).toHaveAttribute(
		"aria-pressed",
		"false",
	);

	await addReference(page, "Panorama", "Referência para medir a largura útil");
	const gallery = page.locator("[data-gallery]");
	await expect(gallery).toBeVisible();

	const gallery1920 = await gallery.boundingBox();
	expect(gallery1920).not.toBeNull();
	expect(gallery1920?.width ?? 0).toBeGreaterThan(1700);

	const search = page.getByPlaceholder("Buscar título, descrição, autor ou data...");
	const searchBox = await search.locator("..").boundingBox();
	const brand = await page.locator(".brand").boundingBox();
	const account = await page.locator(".account-menu-trigger").boundingBox();
	const add = await page.getByRole("button", { name: "Adicionar imagem" }).boundingBox();
	expect(searchBox).not.toBeNull();
	expect(brand).not.toBeNull();
	expect(account).not.toBeNull();
	expect(add).not.toBeNull();
	expect(searchBox?.x ?? 0).toBeGreaterThanOrEqual(
		(brand?.x ?? 0) + (brand?.width ?? 0) + 4,
	);
	expect((add?.x ?? 0) + (add?.width ?? 0)).toBeLessThanOrEqual(
		(account?.x ?? 0) - 6,
	);

	await filters.getByRole("button", { name: /Meus itens/ }).click();
	await expect(filters.getByRole("button", { name: /Meus itens/ })).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await expect(filters.getByRole("button", { name: /Meus itens/ })).toContainText("1");

	await page.getByRole("button", { name: "Adicionar Panorama aos favoritos" }).click();
	await expect(filters.getByRole("button", { name: /Favoritos/ })).toContainText("1");
	await filters.getByRole("button", { name: /Favoritos/ }).click();
	await expect(filters.getByRole("button", { name: /Favoritos/ })).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await expect(page.getByRole("button", { name: "Panorama", exact: true })).toBeVisible();

	await page.setViewportSize({ width: 2560, height: 1440 });
	await expect
		.poll(async () => (await gallery.boundingBox())?.width ?? 0)
		.toBeGreaterThan((gallery1920?.width ?? 0) + 150);
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true);
});

test("Lembra reflows at a 200% zoom equivalent without hiding filters", async ({ page }) => {
	// 1920 CSS pixels at 200% zoom expose roughly a 960px-wide layout viewport.
	await page.setViewportSize({ width: 960, height: 540 });
	await page.goto("/lembra");

	const filters = page.getByRole("navigation", { name: "Filtros do Lembra" });
	await expect(filters).toBeVisible();
	await expect(filters.getByRole("button", { name: /Lembra/ })).toBeVisible();
	await expect(filters.getByRole("button", { name: /Meus itens/ })).toBeVisible();
	await expect(filters.getByRole("button", { name: /Favoritos/ })).toBeVisible();

	const dateFilter = page.locator("details").filter({ hasText: "Data" });
	await dateFilter.locator("summary").click();
	await expect(dateFilter).toHaveAttribute("open", "");
	const datePanel = dateFilter.locator("div").first();
	const panelBox = await datePanel.boundingBox();
	expect(panelBox).not.toBeNull();
	expect((panelBox?.x ?? 0) + (panelBox?.width ?? 0)).toBeLessThanOrEqual(960);

	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true);
});

test("Lembra keeps broken media compact instead of reserving artwork height", async ({ page }) => {
	await page.setViewportSize({ width: 1366, height: 768 });
	await page.goto("/lembra");
	await addReference(page, "Sem mídia", "O texto continua útil mesmo sem artwork");

	const card = page.locator("article").filter({ hasText: "Sem mídia" });
	const image = card.locator("img");
	await expect(image).toBeVisible();
	await image.dispatchEvent("error");

	await expect(card).toContainText("Imagem indisponível");
	await expect(card).toContainText("Por Você");
	const media = card.locator("[data-gallery-media]");
	const mediaBox = await media.boundingBox();
	expect(mediaBox).not.toBeNull();
	expect(mediaBox?.height ?? 999).toBeLessThanOrEqual(160);

	await card.getByRole("button", { name: "Sem mídia", exact: true }).click();
	const viewer = page.getByRole("dialog");
	await expect(viewer.getByRole("heading", { name: "Sem mídia" })).toBeVisible();
	await expect(viewer).toContainText("O texto continua útil mesmo sem artwork");
});


test("Lembra viewer releases modal focus and document scrolling after Escape", async ({
	page,
}) => {
	for (const viewport of [
		{ width: 320, height: 760 },
		{ width: 390, height: 844 },
		{ width: 683, height: 384 },
		{ width: 1100, height: 500 },
	]) {
		await page.setViewportSize(viewport);
		await page.goto("/e2e-fixtures/lembra-campaigns");

		const opener = page.getByRole("button", { name: "Histórica", exact: true });
		await expect(opener).toBeVisible();
		await opener.click();

		const viewer = page.getByRole("dialog");
		await expect(viewer).toBeVisible();
		const edit = viewer.getByRole("button", { name: "Editar", exact: true });
		await edit.scrollIntoViewIfNeeded();
		await expect(edit).toBeVisible();

		await page.keyboard.press("Escape");
		await expect(viewer).not.toBeVisible();
		await expect(opener).toBeFocused();

		const overflow = await page.evaluate(() => ({
			html: getComputedStyle(document.documentElement).overflowY,
			body: getComputedStyle(document.body).overflowY,
		}));
		expect(overflow.html).not.toBe("hidden");
		expect(overflow.body).not.toBe("hidden");

		await page.evaluate(() => {
			document.getElementById("lembra-scroll-release-probe")?.remove();
			const probe = document.createElement("div");
			probe.id = "lembra-scroll-release-probe";
			probe.setAttribute("aria-hidden", "true");
			probe.style.height = "1600px";
			probe.style.width = "1px";
			probe.style.pointerEvents = "none";
			document.body.append(probe);
			window.scrollTo(0, 0);
		});
		await page.evaluate(() => window.scrollTo(0, 500));
		await expect
			.poll(() => page.evaluate(() => window.scrollY))
			.toBeGreaterThan(100);
	}
});
