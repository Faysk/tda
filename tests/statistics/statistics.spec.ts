import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { selectThemedOption } from "../helpers/themed-select";

test.beforeEach(async ({ request }) => {
	await request.post("http://127.0.0.1:3103/fixture/reset");
});

async function signIn(context: BrowserContext, sub: string) {
	const exp = Math.floor(Date.now() / 1000) + 3600;
	const encode = (value: unknown) =>
		Buffer.from(JSON.stringify(value)).toString("base64url");
	const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub, exp, role: "authenticated" })}.synthetic`;
	const value = `base64-${encode({ access_token: token, refresh_token: "synthetic", expires_at: exp, expires_in: 3600, token_type: "bearer", user: { id: sub } })}`;
	await context.addCookies([
		{
			name: "tda-discord-session",
			value,
			url: "http://127.0.0.1:3102",
			httpOnly: true,
			sameSite: "Lax",
		},
	]);
}

async function openTranscriptCampaignPicker(page: Page) {
	const trigger = page.getByRole("button", {
		name: "Campanha das transcrições",
	});
	await trigger.click();
	return page.getByRole("listbox", {
		name: "Campanha das transcrições",
	});
}

async function chooseTranscriptCampaign(page: Page, name: string) {
	const listbox = await openTranscriptCampaignPicker(page);
	await listbox.getByRole("option", { name, exact: true }).click();
}

test("anonymous user receives no metrics and is directed to sign in", async ({
	context,
	page,
}) => {
	const response = await page.goto("/transcricoes");
	expect(response?.headers()["cache-control"]).toContain("no-store");
	await expect(
		page.getByText("Entre com sua conta do Discord", { exact: false }),
	).toBeVisible();
	await expect(page.getByRole("link", { name: "Entrar" })).toHaveAttribute(
		"href",
		"/entrar?next=%2Ftranscricoes",
	);
	expect(await response?.text()).not.toContain("A travessia das montanhas");
	const rsc = await context.request.get("/transcricoes?_rsc=anonymous", {
		headers: { RSC: "1" },
	});
	expect(await rsc.text()).not.toContain("A travessia das montanhas");
	expect(await rsc.text()).not.toContain("TRANSCRICAO_PRIVADA");
});

test("authenticated user without permission receives no metrics and is not told to sign in", async ({
	context,
	page,
}) => {
	await signIn(context, "no-grants");
	const response = await page.goto("/transcricoes");
	expect(response?.headers()["cache-control"]).toContain("no-store");
	await expect(
		page.getByRole("heading", { name: "Nenhuma campanha disponível" }),
	).toBeVisible();
	await expect(
		page.getByText("não possui acesso de leitura de transcrições", {
			exact: false,
		}),
	).toBeVisible();
	await expect(
		page.getByRole("link", { name: "Consultar meu acesso" }),
	).toHaveAttribute("href", "/conta");
	await expect(
		page.getByText("Entre com sua conta do Discord", { exact: false }),
	).toHaveCount(0);
	expect(await response?.text()).not.toContain("A travessia das montanhas");
	const rsc = await context.request.get("/transcricoes?_rsc=no-grants", {
		headers: { RSC: "1" },
	});
	expect(await rsc.text()).not.toContain("A travessia das montanhas");
	expect(await rsc.text()).not.toContain("TRANSCRICAO_PRIVADA");
});

test("invalid campaign input is reported as validation instead of access denial", async ({
	context,
	page,
}) => {
	await signIn(context, "reader");
	const response = await page.goto(
		"/transcricoes?campanha=a%2Cslug.eq.b",
	);
	await expect(
		page.getByText("A campanha pedida não está disponível neste contexto.", {
			exact: false,
		}),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Campanha das transcrições" }),
	).toHaveText("Selecionar");
	expect(await response?.text()).not.toContain("A travessia das montanhas");
});

test("read-only user sees a compact searchable and sortable session inventory", async ({
	context,
	page,
}, info) => {
	await signIn(context, "reader");
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const response = await page.goto("/transcricoes");

	const heading = page.getByRole("heading", {
		level: 1,
		name: /Crônicas da Mesa/,
	});
	await expect(heading).toBeVisible();
	const [headingBox, brandBox, triggerBox] = await Promise.all([
		heading.boundingBox(),
		page.locator(".brand").boundingBox(),
		page.locator(".account-menu-trigger").boundingBox(),
	]);
	expect(headingBox).not.toBeNull();
	expect(brandBox).not.toBeNull();
	expect(triggerBox).not.toBeNull();
	if (headingBox && brandBox && triggerBox) {
		const overlaps = (
			left: { x: number; y: number; width: number; height: number },
			right: { x: number; y: number; width: number; height: number },
		) =>
			left.x < right.x + right.width &&
			left.x + left.width > right.x &&
			left.y < right.y + right.height &&
			left.y + left.height > right.y;
		expect(overlaps(headingBox, brandBox)).toBeFalsy();
		expect(overlaps(headingBox, triggerBox)).toBeFalsy();
	}
	const summary = page.getByLabel("Resumo das transcrições");
	await expect(summary).toContainText("410");
	await expect(summary).toContainText("1 h 2 min");
	await expect(summary).toContainText("Palavras 2/3");
	await expect(summary).toContainText("duração 2/3");
	await expect(
		page.getByText(
			"Cobertura incompleta: ausência de dados não significa zero.",
			{ exact: true },
		),
	).toBeVisible();

	await page.getByText("Como é calculado?", { exact: true }).click();
	await expect(
		page.getByText("Palavras do texto atual, separadas por espaços.", {
			exact: false,
		}),
	).toBeVisible();

	const table = page.getByRole("table", {
		name: "Inventário de cobertura das transcrições",
	});
	await expect(table.locator("th[scope=col]")).toHaveCount(4);
	await expect(table.locator("tbody tr")).toHaveCount(3);
	await expect(table).toContainText("Não informada");
	await expect(table).toContainText("Não informadas");

	const search = page.getByRole("searchbox", { name: "Buscar sessão" });
	const coverage = page.getByLabel("Cobertura");
	const sort = page.getByLabel("Ordenar");

	await search.fill("reencontro a beira");
	await expect(table.locator("tbody tr")).toHaveCount(1);
	await expect(table).toContainText("O reencontro à beira do rio");
	await search.fill("");

	await selectThemedOption(page, coverage, "incomplete");
	await expect(table.locator("tbody tr")).toHaveCount(2);
	await selectThemedOption(page, coverage, "all");

	await selectThemedOption(page, sort, "title-asc");
	const rows = table.locator("tbody tr");
	await expect(rows.nth(0)).toContainText("A travessia das montanhas");
	await expect(rows.nth(1)).toContainText("O reencontro à beira do rio");
	await expect(rows.nth(2)).toContainText("Uma nova jornada");

	await search.focus();
	await page.keyboard.press("Tab");
	await expect(coverage).toBeFocused();
	await page.keyboard.press("Tab");
	await expect(sort).toBeFocused();

	// The single authorized campaign canonicalizes through a redirect. Reading the
	// original navigation body is not stable in Chromium after redirect; inspect the
	// rendered final document instead while keeping the response for cache headers.
	const html = await page.content();
	expect(html).not.toContain("TRANSCRICAO_PRIVADA");
	expect(html).not.toContain("synthetic-server-key");
	const rsc = await context.request.get("/transcricoes?_rsc=reader", {
		headers: { RSC: "1" },
	});
	expect(await rsc.text()).not.toContain("TRANSCRICAO_PRIVADA");
	expect(response?.headers()["cache-control"]).toContain("private");
	expect(response?.headers()["cache-control"]).toContain("no-store");
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= innerWidth,
		),
	).toBe(true);

	if (info.project.name === "desktop-1080p") {
		const lastRowBox = await rows.nth(2).boundingBox();
		expect(lastRowBox).not.toBeNull();
		expect(lastRowBox?.y ?? 1081).toBeLessThan(1080);
	}

	expect(errors).toEqual([]);
	await page.evaluate(() => {
		if (document.activeElement instanceof HTMLElement) {
			document.activeElement.blur();
		}
		window.scrollTo(0, 0);
	});
	await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
	await page.screenshot({
		path: info.outputPath("statistics-" + info.project.name + ".png"),
		fullPage: true,
	});

	await page.goto("/transcricoes?campanha=other");
	await expect(
		page.getByText("A campanha pedida não está disponível neste contexto.", {
			exact: false,
		}),
	).toBeVisible();
	await expect(page.getByText("Antes que seja tarde")).toHaveCount(0);
	await expect(page.getByRole("table")).toHaveCount(0);
	await context.clearCookies();
	await page.goto("/transcricoes");
	await expect(
		page.getByText("Entre com sua conta do Discord", { exact: false }),
	).toBeVisible();
	await expect(page.getByRole("table")).toHaveCount(0);
});

test("public pages do not carry private metrics or transcript payloads", async ({
	page,
}) => {
	for (const path of ["/", "/sessoes"]) {
		const response = await page.goto(path);
		const html = await response?.text();
		expect(html).not.toContain("TRANSCRICAO_PRIVADA");
		expect(html).not.toContain("Palavras conhecidas");
		expect(html).not.toContain("Duração registrada conhecida");
	}
});

test("a reload recomputes metrics after editing the synthetic source", async ({
	context,
	page,
}) => {
	await signIn(context, "reader");
	await page.goto("/transcricoes");
	await context.request.post("http://127.0.0.1:3103/fixture/revise");
	await page.reload();
	await expect(page.getByLabel("Resumo das transcrições")).toContainText("615");
});


test("multi-campaign reader selects by human name and keeps A/B totals isolated across reload and back", async ({
	context,
	page,
}) => {
	await signIn(context, "reader-ab");
	await page.goto("/transcricoes");

	await expect(
		page.getByRole("heading", { name: "Escolha a campanha" }),
	).toBeVisible();
	const selector = page.getByRole("button", {
		name: "Campanha das transcrições",
	});
	await expect(selector).toHaveText("Selecionar");
	const options = await openTranscriptCampaignPicker(page);
	await expect(options.getByRole("option")).toHaveCount(2);
	await expect(
		options.getByRole("option", { name: "Crônicas da Mesa", exact: true }),
	).toBeVisible();
	await expect(
		options.getByRole("option", { name: "Antes que seja tarde", exact: true }),
	).toBeVisible();

	await options
		.getByRole("option", { name: "Antes que seja tarde", exact: true })
		.click();
	await expect(selector).toHaveText("Antes que seja tarde");
	await page.getByRole("button", { name: "Abrir transcrições" }).click();
	await expect(page).toHaveURL(/\/transcricoes\?campanha=other$/);
	await expect(
		page.getByRole("heading", { level: 1, name: "Antes que seja tarde" }),
	).toBeVisible();
	await expect(page.getByLabel(/Resumo das transcrições/)).toContainText("7");
	await expect(page.getByRole("table")).toContainText(
		"A mesma identidade em outra campanha",
	);

	await page.reload();
	await expect(page).toHaveURL(/campanha=other/);
	await expect(page.getByLabel(/Resumo das transcrições/)).toContainText("7");

	await chooseTranscriptCampaign(page, "Crônicas da Mesa");
	await page.getByRole("button", { name: "Trocar campanha" }).click();
	await expect(page).toHaveURL(/campanha=yuhara-main/);
	await expect(page.getByLabel(/Resumo das transcrições/)).toContainText("410");
	await expect(page.getByRole("table")).toContainText("A travessia das montanhas");
	await expect(page.getByRole("table")).not.toContainText(
		"A mesma identidade em outra campanha",
	);

	await page.goBack();
	await expect(page).toHaveURL(/campanha=other/);
	await expect(page.getByLabel(/Resumo das transcrições/)).toContainText("7");
});

test("project transcript grant discovers active and archived campaigns without exposing technical slugs as titles", async ({
	context,
	page,
}) => {
	await signIn(context, "project-reader");
	await page.goto("/transcricoes");

	const selector = page.getByRole("button", {
		name: "Campanha das transcrições",
	});
	await expect(selector).toHaveText("Selecionar");
	const options = await openTranscriptCampaignPicker(page);
	await expect(
		options.getByRole("option", { name: "Crônicas da Mesa", exact: true }),
	).toBeVisible();
	await expect(
		options.getByRole("option", { name: "Antes que seja tarde", exact: true }),
	).toBeVisible();
	await expect(
		options.getByRole("option", {
			name: "Memórias arquivadas (arquivada)",
			exact: true,
		}),
	).toBeVisible();
	await expect(page.getByRole("heading", { level: 1 })).not.toContainText(
		"yuhara-main",
	);
});

test("archived campaign remains readable but is labeled as historical context", async ({
	context,
	page,
}) => {
	await signIn(context, "archived-reader");
	await page.goto("/transcricoes");

	await expect(page).toHaveURL(/\/edit\/arquivo-antigo\/transcricoes$/u);
	await expect(
		page.getByRole("heading", { level: 1, name: "Memórias arquivadas" }),
	).toBeVisible();
	await expect(
		page.getByText("permanece disponível para leitura histórica autorizada", {
			exact: false,
		}),
	).toBeVisible();
	await expect(page.getByLabel(/Resumo das transcrições/)).toContainText("3");
});

test("narrative review preserves campaign identity across reload, switch and back", async ({
	context,
	page,
}) => {
	await signIn(context, "reviewer-ab");
	await page.goto("/edit/revisao");

	await expect(
		page.getByRole("heading", { name: "Escolha a campanha" }),
	).toBeVisible();
	const selector = page.getByLabel("Campanha");
	await selectThemedOption(page, selector, "other");
	await page.getByRole("button", { name: "Abrir revisão" }).click();

	await expect(page).toHaveURL(/\/edit\/revisao\?campanha=other$/);
	await expect(
		page.getByRole("heading", {
			level: 1,
			name: "Revisão narrativa",
		}),
	).toBeVisible();
	await expect(
		page
			.locator('[data-operational-page-header="true"]')
			.getByText("Antes que seja tarde", { exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("heading", {
			name: "Candidatos pendentes · Antes que seja tarde",
		}),
	).toBeVisible();
	await expect(page.getByText("Nenhum candidato pendente")).toBeVisible();

	await page.reload();
	await expect(page).toHaveURL(/campanha=other/);
	await expect(
		page.getByRole("heading", {
			level: 1,
			name: "Revisão narrativa",
		}),
	).toBeVisible();
	await expect(
		page
			.locator('[data-operational-page-header="true"]')
			.getByText("Antes que seja tarde", { exact: true }),
	).toBeVisible();

	await selectThemedOption(page, page.getByLabel("Campanha"), "yuhara-main");
	await page.getByRole("button", { name: "Trocar campanha" }).click();
	await expect(page).toHaveURL(/campanha=yuhara-main/);
	await expect(
		page
			.locator('[data-operational-page-header="true"]')
			.getByText("Crônicas da Mesa", { exact: true }),
	).toBeVisible();

	await page.goBack();
	await expect(page).toHaveURL(/campanha=other/);
	await expect(
		page
			.locator('[data-operational-page-header="true"]')
			.getByText("Antes que seja tarde", { exact: true }),
	).toBeVisible();
});

test("archived campaign review is historical and does not expose decision controls", async ({
	context,
	page,
}) => {
	await signIn(context, "project-reviewer");
	await page.goto("/edit/revisao?campanha=arquivo-antigo");

	await expect(
		page.getByRole("heading", {
			level: 1,
			name: "Revisão narrativa",
		}),
	).toBeVisible();
	await expect(
		page
			.locator('[data-operational-page-header="true"]')
			.getByText("Memórias arquivadas", { exact: true }),
	).toBeVisible();
	await expect(
		page.getByText("Campanha arquivada: leitura histórica", { exact: false }),
	).toBeVisible();
	await expect(page.getByRole("button", { name: "Registrar decisão" })).toHaveCount(0);
});
