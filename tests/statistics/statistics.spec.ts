import { expect, test, type BrowserContext } from "@playwright/test";

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

test("anonymous and authenticated without permission receive no metrics in HTML or RSC", async ({
	context,
	page,
}) => {
	for (const subject of [null, "no-grants"]) {
		if (subject) await signIn(context, subject);
		const response = await page.goto("/transcricoes");
		expect(response?.headers()["cache-control"]).toContain("no-store");
		await expect(
			page.getByText("Entre com uma conta com permissão", { exact: false }),
		).toBeVisible();
		expect(await response?.text()).not.toContain("A travessia das montanhas");
		const rsc = await context.request.get("/transcricoes?_rsc=synthetic", {
			headers: { RSC: "1" },
		});
		expect(await rsc.text()).not.toContain("A travessia das montanhas");
		expect(await rsc.text()).not.toContain("TRANSCRICAO_PRIVADA");
	}
});

test("read-only user sees complete totals, missing coverage and responsive session cards", async ({
	context,
	page,
}, info) => {
	await signIn(context, "reader");
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const response = await page.goto("/transcricoes");
	await expect(
		page.getByRole("heading", { name: "Palavras e tempo" }),
	).toBeVisible();
	const summary = page.getByLabel("Totais das transcrições");
	await expect(summary).toContainText("410");
	await expect(summary).toContainText("1 h 2 min");
	await expect(summary).toContainText("2 de 3 sessões com contagem");
	await expect(page.getByRole("status")).toContainText("Cobertura incompleta");
	await expect(page.getByRole("article")).toHaveCount(3);
	await expect(page.getByRole("article").nth(1)).toContainText("Não informada");
	await expect(page.getByRole("article").nth(2)).toContainText(
		"Não informadas",
	);
	const html = await response?.text();
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
	expect(errors).toEqual([]);
	await page.screenshot({
		path: info.outputPath("statistics.png"),
		fullPage: true,
	});
	await page.goto("/transcricoes?campanha=other");
	await expect(
		page.getByText("Entre com uma conta com permissão", { exact: false }),
	).toBeVisible();
	await expect(page.getByRole("article")).toHaveCount(0);
	await context.clearCookies();
	await page.goto("/transcricoes");
	await expect(page.getByRole("article")).toHaveCount(0);
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
	await expect(page.getByLabel("Totais das transcrições")).toContainText("615");
});
