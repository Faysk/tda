import {
	expect,
	test,
	type BrowserContext,
	type APIRequestContext,
} from "@playwright/test";

const path = "/edit/yuhara-main/permissions";
const api = "/api/edit/yuhara-main/permissions";
const fixtureOrigin = "http://127.0.0.1:3116";
const IDS = {
	manager: "11111111-1111-4111-8111-111111111111",
	member: "88888888-8888-4888-8888-888888888888",
	managerRole: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
	readerRole: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
	technicalRole: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
	managerAssignment: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
};

async function resetFixture(
	request: APIRequestContext,
	options: { withoutProjectAdmin?: boolean } = {},
) {
	const response = await request.post(`${fixtureOrigin}/reset`, {
		data: options,
	});
	expect(response.ok()).toBe(true);
}

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

async function directory(context: BrowserContext) {
	const response = await context.request.get(api);
	expect(response.status()).toBe(200);
	return (await response.json()).value;
}

async function postMutation(
	context: BrowserContext,
	body: Record<string, unknown>,
) {
	return context.request.post(api, { data: body });
}

async function fixtureRequests(request: APIRequestContext) {
	const response = await request.get(`${fixtureOrigin}/requests`);
	expect(response.ok()).toBe(true);
	return (await response.json()) as Array<{
		method: string;
		path: string;
		query: string;
	}>;
}

test.beforeEach(async ({ request }) => {
	await resetFixture(request);
});

test("anonymous and unauthorized identities cannot read or mutate the directory", async ({
	page,
	context,
}) => {
	await page.goto(path);
	await expect(
		page.getByRole("heading", { name: "Entre para administrar permissões" }),
	).toBeVisible();

	const anonymousMutation = await postMutation(context, {
		targetProfileId: IDS.member,
		expectedRevision: 0,
		changes: [{ operation: "grant", roleId: IDS.readerRole }],
		operationId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
	});
	expect(anonymousMutation.status()).toBe(401);

	for (const id of ["reader", "technical", "foreign", "expired"]) {
		await context.clearCookies();
		await login(context, id);
		const read = await context.request.get(api);
		expect(read.status()).toBe(403);
		const write = await postMutation(context, {
			targetProfileId: IDS.member,
			expectedRevision: 0,
			changes: [{ operation: "grant", roleId: IDS.readerRole }],
			operationId: crypto.randomUUID(),
		});
		expect(write.status()).toBe(403);
	}

	await expect(page.locator("body")).not.toContainText("PRIVATE_");
});

test("governed console shows people, human access, filters and technical details progressively", async ({
	page,
	context,
}, testInfo) => {
	await login(context, "manager");
	await page.goto(path);

	await expect(
		page.getByText("Administração governada", { exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("navigation", { name: "Navegação do Edit" }),
	).toHaveCount(0);
	await expect(page.locator("[data-operational-page-header='true']")).toBeVisible();

	const [headingBox, brandBox, triggerBox] = await Promise.all([
		page.getByRole("heading", { level: 1, name: "Permissões" }).boundingBox(),
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
	await expect(page.getByRole("table")).toBeVisible();
	await expect(page.getByRole("row", { name: /Pessoa member/u })).toBeVisible();
	await expect(page.locator("body")).not.toContainText("PRIVATE_");

	const search = page.getByRole("searchbox", { name: "Buscar pessoa ou acesso" });
	await search.fill("member");
	await expect(page.getByRole("row", { name: /Pessoa member/u })).toBeVisible();
	await expect(page.getByRole("row", { name: /Pessoa reader/u })).toHaveCount(0);
	await search.fill("");

	await page.getByRole("combobox", { name: "Filtrar por acesso" }).selectOption("without");
	await expect(page.getByRole("row", { name: /Pessoa member/u })).toBeVisible();
	await page.getByRole("combobox", { name: "Filtrar por acesso" }).selectOption("all");

	const technical = page
		.getByRole("row", { name: /Pessoa technical/u })
		.getByText(/Operação técnica/u);
	await expect(technical).toContainText("herdada");

	const managerRow = page.getByRole("row", { name: /Pessoa manager/u });
	const allAccess = managerRow.getByText(/Ver todos os acessos/);
	await expect(allAccess).toBeVisible();
	await allAccess.click();
	await expect(managerRow.getByText("Gerenciar permissões", { exact: true })).toBeVisible();
	await expect(managerRow).not.toContainText("campaign.permissions.manage");

	const roleCatalog = page.getByText(/Funções disponíveis/);
	await roleCatalog.click();
	await expect(roleCatalog.locator("..").getByText("Leitura sintética", { exact: true }).first()).toBeVisible();

	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth + 1,
		),
	).toBe(true);
	await page.screenshot({
		path: testInfo.outputPath("permissions-console-light.png"),
		fullPage: false,
	});

	await page.evaluate(() => {
		document.documentElement.setAttribute("data-theme", "dark");
	});
	await page.screenshot({
		path: testInfo.outputPath("permissions-console-dark.png"),
		fullPage: false,
	});
});

test("person management previews resulting access then grants and revokes an existing role", async ({
	page,
	context,
}, testInfo) => {
	await login(context, "manager");
	await page.goto(path);

	const memberRow = page.getByRole("row", { name: /Pessoa member/u });
	await memberRow.getByRole("button", { name: "Gerenciar" }).click();

	const dialog = page.getByRole("dialog", { name: "Pessoa member" });
	await expect(dialog).toBeVisible();
	const reader = dialog.getByRole("checkbox", { name: /Leitura sintética/u });
	await reader.check();
	await expect(
		dialog.getByText("Ler transcrições completas", { exact: true }),
	).toBeVisible();
	await dialog.getByText("Motivo (opcional)").locator("..").getByRole("textbox").fill(
		"Acesso sintético para o gate",
	);
	await page.screenshot({
		path: testInfo.outputPath("permissions-preview.png"),
		fullPage: false,
	});
	await dialog.getByRole("button", { name: "Aplicar mudanças" }).click();

	await expect(
		page.getByText("Acesso atualizado e confirmado pelo servidor.", {
			exact: true,
		}),
	).toBeVisible();
	await expect(memberRow).toContainText("Leitura sintética");
	await expect(memberRow).toContainText("Ler transcrições completas");

	await memberRow.getByRole("button", { name: "Gerenciar" }).click();
	const revokeDialog = page.getByRole("dialog", { name: "Pessoa member" });
	await revokeDialog
		.getByRole("checkbox", { name: /Leitura sintética/u })
		.uncheck();
	await revokeDialog.getByRole("button", { name: "Aplicar mudanças" }).click();
	await expect(
		page.getByText("Acesso atualizado e confirmado pelo servidor.", {
			exact: true,
		}),
	).toBeVisible();
	await expect(memberRow).toContainText("Nenhuma");

	await page.getByRole("button", { name: "Histórico" }).click();
	const history = page.getByRole("region", { name: "Histórico recente" });
	await expect(history).toContainText("concedeu");
	await expect(history).toContainText("revogou");
	await expect(history).toContainText("Pessoa member");
});

test("sensitive self-revocation is summarized once and Escape sends no mutation", async ({
	page,
	context,
	request,
}, testInfo) => {
	await login(context, "manager");
	await page.goto(path);

	const managerRow = page.getByRole("row", { name: /Pessoa manager/u });
	await managerRow.getByRole("button", { name: "Gerenciar" }).click();
	const drawer = page.getByRole("dialog", { name: "Pessoa manager" });
	const managerRole = drawer.getByRole("checkbox", { name: /Gestão sintética/u });
	await managerRole.uncheck();
	const applyButton = drawer.getByRole("button", { name: "Aplicar mudanças" });
	await applyButton.click();

	const confirmation = page.getByRole("dialog", {
		name: "Confirmar mudança de acesso?",
	});
	await expect(confirmation).toBeVisible();
	await expect(
		confirmation.getByRole("button", { name: "Continuar editando" }),
	).toBeFocused();
	await expect(
		confirmation.getByText("Gestão sintética", { exact: true }),
	).toBeVisible();
	await expect(confirmation).toContainText(
		"Esta mudança afeta administração, publicação ou aprovação de cânone.",
	);
	await expect(confirmation).toContainText(
		"Você está removendo uma função da própria conta.",
	);
	await page.screenshot({
		path: testInfo.outputPath("permissions-confirmation-self-revoke.png"),
		fullPage: false,
	});

	await page.keyboard.press("Escape");
	await expect(confirmation).toBeHidden();
	await expect(drawer).toBeVisible();
	await expect(managerRole).not.toBeChecked();
	await expect(applyButton).toBeFocused();

	const requests = await fixtureRequests(request);
	expect(
		requests.filter(
			(entry) =>
				entry.method === "POST" &&
				entry.path === "/rest/v1/rpc/manage_campaign_role_assignments",
		),
	).toHaveLength(0);
});

test("server rejection stays in the confirmation dialog with the frozen access plan", async ({
	page,
	context,
	request,
}) => {
	await resetFixture(request, { withoutProjectAdmin: true });
	await login(context, "manager");
	await page.goto(path);

	const managerRow = page.getByRole("row", { name: /Pessoa manager/u });
	await managerRow.getByRole("button", { name: "Gerenciar" }).click();
	const drawer = page.getByRole("dialog", { name: "Pessoa manager" });
	await drawer.getByRole("checkbox", { name: /Gestão sintética/u }).uncheck();
	await drawer.getByRole("button", { name: "Aplicar mudanças" }).click();

	const confirmation = page.getByRole("dialog", {
		name: "Confirmar mudança de acesso?",
	});
	await confirmation.getByRole("button", { name: "Aplicar mudanças" }).click();

	await expect(confirmation).toBeVisible();
	await expect(
		confirmation.getByText("Gestão sintética", { exact: true }),
	).toBeVisible();
	await expect(confirmation).toContainText(
		"A mudança deixaria a campanha sem um administrador capaz de recuperar o acesso.",
	);
	await expect(
		confirmation.getByRole("button", { name: "Aplicar mudanças" }),
	).toBeEnabled();
});

test("confirmation blocks duplicate submit and cannot close while the mutation is in flight", async ({
	page,
	context,
}) => {
	await login(context, "manager");

	const postBodies: Record<string, unknown>[] = [];
	let releaseFirst: (() => void) | undefined;
	let markFirstSeen: (() => void) | undefined;
	const firstSeen = new Promise<void>((resolve) => {
		markFirstSeen = resolve;
	});
	const holdFirst = new Promise<void>((resolve) => {
		releaseFirst = resolve;
	});

	await page.route("**/api/edit/yuhara-main/permissions", async (route) => {
		if (route.request().method() === "POST") {
			postBodies.push(route.request().postDataJSON() as Record<string, unknown>);
			if (postBodies.length === 1) {
				markFirstSeen?.();
				await holdFirst;
			}
		}
		await route.continue();
	});

	await page.goto(path);
	const memberRow = page.getByRole("row", { name: /Pessoa member/u });
	await memberRow.getByRole("button", { name: "Gerenciar" }).click();
	const drawer = page.getByRole("dialog", { name: "Pessoa member" });
	await drawer.getByRole("checkbox", { name: /Gestão sintética/u }).check();
	await drawer.getByRole("button", { name: "Aplicar mudanças" }).click();

	const confirmation = page.getByRole("dialog", {
		name: "Confirmar mudança de acesso?",
	});
	const confirmButton = confirmation.getByRole("button", {
		name: "Aplicar mudanças",
	});
	await confirmButton.click();
	await firstSeen;
	const pendingButton = confirmation.getByRole("button", { name: "Aplicando…" });
	await expect(pendingButton).toBeDisabled();

	await pendingButton.dispatchEvent("click");
	await page.keyboard.press("Escape");
	await expect(confirmation).toBeVisible();
	expect(postBodies).toHaveLength(1);

	releaseFirst?.();
	await expect(confirmation).toBeHidden();
	await expect(
		page.getByText("Acesso atualizado e confirmado pelo servidor.", {
			exact: true,
		}),
	).toBeVisible();
	expect(postBodies).toHaveLength(1);
});

test("uncertain retry keeps the same operation id and confirmation summary", async ({
	page,
	context,
}) => {
	await login(context, "manager");

	const postBodies: Record<string, unknown>[] = [];
	let abortFirst = true;
	await page.route("**/api/edit/yuhara-main/permissions", async (route) => {
		if (route.request().method() === "POST") {
			postBodies.push(route.request().postDataJSON() as Record<string, unknown>);
			if (abortFirst) {
				abortFirst = false;
				await route.abort("failed");
				return;
			}
		}
		await route.continue();
	});

	await page.goto(path);
	const memberRow = page.getByRole("row", { name: /Pessoa member/u });
	await memberRow.getByRole("button", { name: "Gerenciar" }).click();
	const drawer = page.getByRole("dialog", { name: "Pessoa member" });
	await drawer.getByRole("checkbox", { name: /Gestão sintética/u }).check();
	await drawer.getByRole("button", { name: "Aplicar mudanças" }).click();

	const confirmation = page.getByRole("dialog", {
		name: "Confirmar mudança de acesso?",
	});
	await confirmation.getByRole("button", { name: "Aplicar mudanças" }).click();
	await expect(confirmation).toContainText(
		"A resposta da alteração não pôde ser confirmada.",
	);
	await expect(
		confirmation.getByText("Gestão sintética", { exact: true }),
	).toBeVisible();
	expect(postBodies).toHaveLength(1);

	await confirmation.getByRole("button", { name: "Aplicar mudanças" }).click();
	await expect(confirmation).toBeHidden();
	expect(postBodies).toHaveLength(2);
	expect(postBodies[0]?.operationId).toBeTruthy();
	expect(postBodies[1]?.operationId).toBe(postBodies[0]?.operationId);
});

test("stale CAS, replay, project-role delegation and sensitive confirmation fail safely", async ({
	context,
}) => {
	await login(context, "manager");

	const first = await postMutation(context, {
		targetProfileId: IDS.member,
		expectedRevision: 0,
		changes: [{ operation: "grant", roleId: IDS.readerRole }],
		operationId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
	});
	expect(first.status()).toBe(200);
	const firstBody = await first.json();
	expect(firstBody).toMatchObject({
		ok: true,
		status: "updated",
	});

	const replay = await postMutation(context, {
		targetProfileId: IDS.member,
		expectedRevision: 0,
		changes: [{ operation: "grant", roleId: IDS.readerRole }],
		operationId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
	});
	expect(replay.status()).toBe(200);
	expect(await replay.json()).toMatchObject({ ok: true, status: "replayed" });

	const stale = await postMutation(context, {
		targetProfileId: IDS.member,
		expectedRevision: 0,
		changes: [
			{
				operation: "grant",
				roleId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
			},
		],
		operationId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
	});
	expect(stale.status()).toBe(409);
	expect(await stale.json()).toMatchObject({
		ok: false,
		reason: "conflict",
		revision: 1,
	});

	await resetFixture(context.request);
	const projectRole = await postMutation(context, {
		targetProfileId: IDS.member,
		expectedRevision: 0,
		changes: [{ operation: "grant", roleId: IDS.technicalRole }],
		operationId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
	});
	expect(projectRole.status()).toBe(403);
	expect(await projectRole.json()).toMatchObject({
		ok: false,
		reason: "delegation_forbidden",
	});

	const sensitive = await postMutation(context, {
		targetProfileId: IDS.member,
		expectedRevision: 0,
		changes: [{ operation: "grant", roleId: IDS.managerRole }],
		operationId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc4",
	});
	expect(sensitive.status()).toBe(409);
	expect(await sensitive.json()).toMatchObject({
		ok: false,
		reason: "confirmation_required",
		kind: "sensitive_grant",
	});

	const confirmed = await postMutation(context, {
		targetProfileId: IDS.member,
		expectedRevision: 0,
		changes: [{ operation: "grant", roleId: IDS.managerRole }],
		operationId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc5",
		confirmSensitive: true,
	});
	expect(confirmed.status()).toBe(200);
});

test("last-admin safeguard blocks confirmed self revoke when no recovery admin remains", async ({
	context,
	request,
}) => {
	await resetFixture(request, { withoutProjectAdmin: true });
	await login(context, "manager");
	const response = await postMutation(context, {
		targetProfileId: IDS.manager,
		expectedRevision: 0,
		changes: [
			{
				operation: "revoke",
				roleId: IDS.managerRole,
				assignmentId: IDS.managerAssignment,
			},
		],
		operationId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc6",
		confirmSensitive: true,
		confirmSelfRevoke: true,
	});
	expect(response.status()).toBe(409);
	expect(await response.json()).toMatchObject({
		ok: false,
		reason: "last_admin",
	});
});

test("revoked admin authority fails closed on the next server request", async ({
	browser,
	context,
}) => {
	await login(context, "manager");
	const grant = await postMutation(context, {
		targetProfileId: IDS.member,
		expectedRevision: 0,
		changes: [{ operation: "grant", roleId: IDS.managerRole }],
		operationId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc7",
		confirmSensitive: true,
	});
	expect(grant.status()).toBe(200);
	const afterGrant = (await grant.json()).value;
	const member = afterGrant.people.find(
		(person: { id: string }) => person.id === IDS.member,
	);
	const assignment = member.roles.find(
		(role: { roleId: string; active: boolean; scopeType: string }) =>
			role.roleId === IDS.managerRole &&
			role.active &&
			role.scopeType === "campaign",
	);
	expect(assignment).toBeTruthy();

	const memberContext = await browser.newContext();
	try {
		await login(memberContext, "member");
		expect((await memberContext.request.get(api)).status()).toBe(200);

		const revoke = await postMutation(context, {
			targetProfileId: IDS.member,
			expectedRevision: member.revision,
			changes: [
				{
					operation: "revoke",
					roleId: IDS.managerRole,
					assignmentId: assignment.id,
				},
			],
			operationId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc8",
			confirmSensitive: true,
		});
		expect(revoke.status()).toBe(200);

		const afterRevoke = await memberContext.request.get(api);
		expect(afterRevoke.status()).toBe(403);
	} finally {
		await memberContext.close();
	}
});

test("viewport matrix and 200% zoom keep management usable without horizontal overflow", async ({
	page,
	context,
}, testInfo) => {
	test.skip(
		testInfo.project.name !== "permissions-desktop",
		"The full viewport matrix runs once; project-level desktop/mobile coverage remains in the other permissions tests.",
	);
	test.setTimeout(60_000);
	await login(context, "manager");

	for (const viewport of [
		{ width: 320, height: 800 },
		{ width: 390, height: 844 },
		{ width: 683, height: 384 },
		{ width: 1366, height: 768 },
		{ width: 1920, height: 1080 },
		{ width: 2560, height: 1440 },
	]) {
		await page.setViewportSize(viewport);
		await page.goto(path);
		await expect(
			page.getByRole("navigation", { name: "Navegação do Edit" }),
		).toHaveCount(0);
		const heading = page.getByRole("heading", { level: 1, name: "Permissões" });
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
		const memberRow = page.getByRole("row", { name: /Pessoa member/u });
		await memberRow.getByRole("button", { name: "Gerenciar" }).click();
		const dialog = page.getByRole("dialog", { name: "Pessoa member" });
		await expect(dialog).toBeVisible();
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth + 1,
			),
		).toBe(true);
		const box = await dialog.boundingBox();
		expect(box).not.toBeNull();
		if (box) {
			expect(box.x).toBeGreaterThanOrEqual(-1);
			expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
		}
		await page.screenshot({
			path: testInfo.outputPath(
				`permissions-${viewport.width}x${viewport.height}.png`,
			),
			fullPage: false,
		});
		await dialog.getByRole("button", { name: "Fechar" }).click();
	}
});
