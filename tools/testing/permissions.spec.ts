import { expect, test, type BrowserContext } from "@playwright/test";

async function login(context: BrowserContext, id: string) {
	const exp = Math.floor(Date.now() / 1000) + 3600;
	const token = [
		Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
			"base64url",
		),
		Buffer.from(
			JSON.stringify({
				sub: id,
				aud: "authenticated",
				role: "authenticated",
				exp,
			}),
		).toString("base64url"),
		"synthetic",
	].join(".");
	const session = {
		access_token: token,
		refresh_token: "synthetic",
		token_type: "bearer",
		expires_at: exp,
		expires_in: 3600,
		user: { id },
	};
	await context.addCookies([
		{
			name: "tda-discord-session",
			value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`,
			url: "http://127.0.0.1:3115",
			httpOnly: true,
			sameSite: "Lax",
		},
	]);
}
const path = "/edit/yuhara-main/permissions";
const api = "/api/edit/yuhara-main/permissions";

test("anonymous page and direct API disclose no directory", async ({
	page,
	request,
}) => {
	await page.goto(path);
	await expect(
		page.getByRole("heading", { name: "Entre para consultar permissões" }),
	).toBeVisible();
	const response = await request.get(
		`${api}?authUserId=manager&action=campaign.permissions.manage`,
	);
	expect(response.status()).toBe(401);
	expect(await response.json()).toEqual({
		ok: false,
		reason: "unauthenticated",
	});
	expect(response.headers()["cache-control"]).toContain("no-store");
	await expect(page.locator("body")).not.toContainText("Pessoa manager");
});
for (const id of [
	"reader",
	"technical",
	"foreign",
	"expired",
	"unlinked",
	"unavailable",
]) {
	test(`server denies ${id}, including forged role metadata`, async ({
		page,
		context,
	}) => {
		await login(context, id);
		const response = await context.request.get(`${api}?authUserId=manager`);
		expect(response.status()).toBe(id === "unavailable" ? 503 : 403);
		expect(await response.text()).not.toMatch(
			/PRIVATE|Pessoa|discord_id|auth_user_id/u,
		);
		await page.goto(path);
		await expect(page.locator("body")).not.toContainText("Pessoa manager");
		await expect(page.getByRole("searchbox")).toHaveCount(0);
	});
}
test("authorized real route renders scoped data, provenance, search and mobile layout", async ({
	page,
	context,
}, testInfo) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await login(context, "manager");
	await page.goto(path);
	await expect(
		page.getByRole("heading", { name: "Pessoa manager", exact: true }),
	).toBeVisible();
	await expect(
		page.getByText("Somente leitura", { exact: true }),
	).toBeVisible();
	await expect(page.locator("body")).toContainText("Direta na campanha");
	await expect(page.locator("body")).toContainText("Herdada do projeto TDA");
	await expect(page.locator("body")).not.toContainText("Pessoa foreign");
	const historical = page.locator("article").filter({
		has: page.getByRole("heading", { name: "Pessoa expired", exact: true }),
	});
	await expect(historical).toContainText("Revogada");
	await expect(historical).toContainText(
		"Sem acesso verificado às operações atuais do Edit.",
	);
	const response = await context.request.get(api);
	expect(response.status()).toBe(200);
	const body = await response.text();
	expect(body).not.toMatch(/PRIVATE|auth_user_id|discord_id|metadata|email/u);
	expect(body).toContain("project.jobs.run");
	const value = JSON.parse(body).value;
	expect(
		value.people.find((person: { id: string }) => person.id === "technical")
			.verifiedEditAccess,
	).toEqual([]);
	await page.getByRole("searchbox").fill("manager");
	await expect(page.locator("article")).toHaveCount(1);
	await page.getByRole("searchbox").fill("no such person");
	await expect(
		page.getByRole("heading", { name: "Nenhum resultado" }),
	).toBeVisible();
	await page.getByRole("searchbox").fill("");
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true);
	await page.screenshot({
		path: testInfo.outputPath("permissions.png"),
		fullPage: true,
	});
	await page.getByRole("switch", { name: "Modo escuro" }).click();
	await expect
		.poll(() =>
			page.evaluate(() =>
				getComputedStyle(document.documentElement)
					.getPropertyValue("--ds-canvas")
					.trim(),
			),
		)
		.toBe("rgb(10, 12, 15)");
	await page.screenshot({
		path: testInfo.outputPath("permissions-dark.png"),
		fullPage: true,
	});
	await page.getByRole("searchbox").focus();
	await expect(page.getByRole("searchbox")).toBeFocused();
	for (const method of ["POST", "PATCH", "DELETE"])
		expect(
			(
				await context.request.fetch(api, {
					method,
					data: { profileId: "reader", role: "manage" },
				})
			).status(),
		).toBe(405);
});
test("cross-campaign access is denied; project action can view authorized empty campaign", async ({
	context,
	page,
}) => {
	await login(context, "manager");
	expect(
		(
			await context.request.get("/api/edit/other-campaign/permissions")
		).status(),
	).toBe(403);
	await context.clearCookies();
	await login(context, "project");
	const response = await context.request.get("/api/edit/empty/permissions");
	expect(response.status()).toBe(200);
	expect((await response.json()).value.people).toEqual([]);
	await page.goto("/edit/empty/permissions");
	await expect(
		page.getByRole("heading", { name: "Nenhuma atribuição encontrada" }),
	).toBeVisible();
	expect(
		(
			await context.request.get("/api/edit/does-not-exist/permissions")
		).status(),
	).toBe(404);
});

test("account tasks reflect access and remain usable at narrow widths", async ({
	page,
	context,
}, testInfo) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await login(context, "reader");
	await page.goto("/conta");
	const tasks = page.getByRole("navigation", { name: "Espaços da campanha" });
	await expect(tasks.getByRole("link")).toHaveCount(2);
	const edit = tasks.getByRole("link", { name: "Abrir Edit", exact: true });
	await expect(edit).toHaveAttribute("href", "/edit");
	await expect(
		page.getByRole("link", { name: "Consultar permissões", exact: true }),
	).toHaveCount(0);
	await edit.focus();
	await expect(edit).toBeFocused();
	expect(
		await edit.evaluate((el) => getComputedStyle(el).outlineStyle),
	).not.toBe("none");
	await page.screenshot({
		path: testInfo.outputPath("account-desktop.png"),
		fullPage: true,
	});
	await page.setViewportSize({ width: 320, height: 800 });
	for (const theme of ["dark", "light"]) {
		await page.evaluate(
			(value) => document.documentElement.setAttribute("data-theme", value),
			theme,
		);
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		).toBe(true);
		await expect(edit).toBeVisible();
		const brand = await page.locator(".brand").boundingBox();
		const navigation = await page.locator(".header-actions").boundingBox();
		expect(brand && navigation).toBeTruthy();
		if (brand && navigation)
			expect(
				navigation.y >= brand.y + brand.height ||
					navigation.x >= brand.x + brand.width,
			).toBe(true);

		await page.screenshot({
			path: testInfo.outputPath(`account-320-${theme}.png`),
			fullPage: true,
		});
	}
	await context.clearCookies();
	await login(context, "manager");
	await page.goto("/conta");
	await expect(
		page.getByRole("heading", { name: "Seu espaço na campanha" }),
	).toBeVisible();
	await expect(page.getByRole("status")).toContainText(
		"Escolha uma das tarefas disponíveis",
	);
	await expect(
		tasks.getByRole("link", { name: "Consultar permissões", exact: true }),
	).toBeVisible();
	await expect(
		tasks.getByRole("link", { name: "Abrir Edit", exact: true }),
	).toHaveCount(0);
});

test("private route returns distinguish denied from unavailable access", async ({
	page,
	context,
}) => {
	await login(context, "manager");
	await page.goto("/edit");
	await expect(page).toHaveURL(/\/conta\?acesso=negado$/u);
	await expect(page.getByRole("alert")).toContainText(
		"não tem acesso à área que você tentou abrir",
	);
	await expect(
		page.getByRole("link", { name: "Consultar permissões", exact: true }),
	).toBeVisible();

	await context.clearCookies();
	await login(context, "unavailable");
	await page.goto("/edit");
	await expect(page).toHaveURL(/\/conta\?acesso=indisponivel$/u);
	await expect(page.getByRole("alert")).toContainText(
		"não conseguiu verificar seu acesso",
	);
});
