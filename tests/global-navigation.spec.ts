import { expect, test } from "@playwright/test";

const publicLabels = ["Sessões","Lembra","Lores","Mundo","Personagens","NPCs","Lugares","Facções","Quests","Músicas","Diários"];
const allToolCapabilities = ["campaign.transcript.read","campaign.local.process","campaign.world.layout.edit","narrative.review.read","campaign.permissions.manage"];

type NavigationState = "anonymous" | "unavailable" | "authenticated_unlinked" | "authenticated_linked" | "authenticated_linked_no_grants";
type MockAccessOptions = Readonly<{ state?: NavigationState; capabilities?: readonly string[]; identity?: Readonly<{displayName:string|null;avatarUrl:string|null}>|null; status?: number }>;

async function mockAccess(page: import("@playwright/test").Page, options: MockAccessOptions = {}) {
	const state=options.state ?? "authenticated_linked";
	const status=options.status ?? (state==="unavailable"?503:200);
	const authenticated=state==="authenticated_unlinked"||state==="authenticated_linked"||state==="authenticated_linked_no_grants";
	await page.route("**/api/auth/me", async route => route.fulfill({
		status, contentType:"application/json",
		body:JSON.stringify({state,scope:{type:"campaign",id:"yuhara-main"},...(authenticated?{identity:options.identity===undefined?{displayName:"Navegação Teste",avatarUrl:null}:options.identity,capabilities:options.capabilities??[]}:{})})
	}));
}

async function openProfile(page: import("@playwright/test").Page) {
	const trigger=page.getByRole("button",{name:"Abrir navegação e conta"});
	await trigger.click();
	await expect(trigger).toHaveAttribute("aria-expanded","true");
	const panel=page.getByRole("region",{name:"Navegação, conta e aparência"});
	await expect(panel).toBeVisible();
	return panel;
}
async function closeProfile(page: import("@playwright/test").Page) {
	await page.getByRole("button",{name:"Abrir navegação e conta"}).click();
	await expect(page.getByRole("button",{name:"Abrir navegação e conta"})).toHaveAttribute("aria-expanded","false");
}
async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
	expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBeTruthy();
}
async function expectPanelContained(page: import("@playwright/test").Page, selector:string) {
	const viewport=page.viewportSize(); expect(viewport).not.toBeNull(); if(!viewport)return;
	const box=await page.locator(selector).boundingBox(); expect(box).not.toBeNull(); if(!box)return;
	expect(box.x).toBeGreaterThanOrEqual(-1); expect(box.x+box.width).toBeLessThanOrEqual(viewport.width+1); expect(box.y).toBeGreaterThanOrEqual(-1); expect(box.y).toBeLessThan(viewport.height);
}

test("avatar is the only global trigger and exposes public IA in stable order", async ({page})=>{
	await mockAccess(page); await page.goto("/sessoes/nonexistent");
	await expect(page.getByRole("button",{name:"Abrir navegação",exact:true})).toHaveCount(0);
	await expect(page.locator(".product-launcher-trigger")).toHaveCount(0);
	const panel=await openProfile(page);
	const navigation=panel.getByRole("navigation",{name:"Navegação principal"});
	expect((await navigation.locator(".product-launcher-link").allTextContents()).slice(0,publicLabels.length)).toEqual(publicLabels);
	await expect(navigation.getByRole("link",{name:"Sessões",exact:true})).toHaveAttribute("aria-current","page");
});

test("unified panel projects only authorized tools", async ({page})=>{
	await mockAccess(page,{capabilities:["campaign.transcript.read","campaign.local.process","campaign.permissions.manage"]});
	await page.goto("/"); const panel=await openProfile(page);
	for(const label of publicLabels) await expect(panel.getByRole("link",{name:label,exact:true})).toBeVisible();
	for(const [label,href] of [["Transcrições","/transcricoes"],["Editar sessões","/edit/sessoes"],["Processar","/edit/processamento"],["Permissões","/edit/yuhara-main/permissions"]] as const)
		await expect(panel.getByRole("link",{name:label,exact:true})).toHaveAttribute("href",href);
	await expect(panel.getByRole("link",{name:"Editar mundo",exact:true})).toHaveCount(0);
	await expect(panel.getByRole("link",{name:"Revisão",exact:true})).toHaveCount(0);
});

test("anonymous and unavailable states keep Explore usable", async ({page})=>{
	await mockAccess(page,{state:"anonymous"}); await page.goto("/sessoes"); let panel=await openProfile(page);
	await expect(panel.getByRole("button",{name:"Entrar com Discord"})).toBeVisible();
	await expect(panel.locator('input[name="next"]')).toHaveValue("/sessoes");
	await expect(panel.getByRole("link",{name:"Mundo",exact:true})).toBeVisible();
	await expect(panel.getByText("Ferramentas",{exact:true})).toHaveCount(0);
	await closeProfile(page);
	await page.unroute("**/api/auth/me");
	await mockAccess(page,{state:"unavailable"}); await page.reload(); panel=await openProfile(page);
	await expect(panel.getByText("Conta temporariamente indisponível",{exact:true})).toBeVisible();
	await expect(panel.getByRole("link",{name:"Mundo",exact:true})).toBeVisible();
	await expect(panel.getByText("Ferramentas",{exact:true})).toHaveCount(0);
});

test("authenticated identity, account, appearance and logout live in the same panel", async ({page})=>{
	await mockAccess(page,{identity:{displayName:"Pessoa Teste",avatarUrl:null},capabilities:allToolCapabilities});
	await page.goto("/"); await expect(page.locator(".account-avatar-initials")).toHaveText("PT");
	const panel=await openProfile(page);
	await expect(panel.getByText("Pessoa Teste",{exact:true})).toBeVisible();
	await expect(panel.getByRole("link",{name:"Conta e acesso"})).toHaveAttribute("href","/conta");
	await expect(panel.getByRole("switch",{name:"Modo escuro"})).toBeVisible();
	await expect(panel.locator('form[action="/auth/logout"]')).toHaveAttribute("method","post");
	await expect(panel.getByText("Ferramentas",{exact:true})).toBeVisible();
});

test("public navigation is usable before private auth settles", async ({page})=>{
	let release:(()=>void)|undefined; const authReleased=new Promise<void>(resolve=>{release=resolve});
	await page.route("**/api/auth/me",async route=>{await authReleased; await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({state:"authenticated_linked",scope:{type:"campaign",id:"yuhara-main"},identity:{displayName:"Pessoa Teste",avatarUrl:null},capabilities:allToolCapabilities})})});
	await page.goto("/"); const panel=await openProfile(page);
	await expect(panel.getByRole("link",{name:"Sessões",exact:true})).toBeVisible();
	await expect(panel.getByText("Ferramentas",{exact:true})).toHaveCount(0);
	release?.(); await expect(panel.getByText("Ferramentas",{exact:true})).toBeVisible();
});

test("Escape, outside click and pathname change dismiss the single panel", async ({page})=>{
	await page.emulateMedia({reducedMotion:"reduce"}); await mockAccess(page); await page.goto("/sessoes");
	const trigger=page.getByRole("button",{name:"Abrir navegação e conta"});
	await trigger.focus(); await page.keyboard.press("Enter"); await expect(trigger).toHaveAttribute("aria-expanded","true");
	await page.keyboard.press("Escape"); await expect(trigger).toHaveAttribute("aria-expanded","false"); await expect(trigger).toBeFocused();
	await openProfile(page); await page.getByRole("heading",{level:1}).click(); await expect(trigger).toHaveAttribute("aria-expanded","false");
	const panel=await openProfile(page); await panel.getByRole("link",{name:"Lores",exact:true}).click(); await expect(page).toHaveURL(/\/lore$/u); await expect(trigger).toHaveAttribute("aria-expanded","false");
});

test("normal motion uses the dedicated 2s reversible transition and closing is inert", async ({page})=>{
	await mockAccess(page); await page.goto("/");
	const trigger=page.getByRole("button",{name:"Abrir navegação e conta"}); await trigger.click();
	const panel=page.locator(".global-profile-panel");
	await expect(panel).toHaveAttribute("data-state",/opening|open/u);
	const duration=await panel.evaluate(el=>getComputedStyle(el).transitionDuration);
	expect(duration.split(",").some(v=>Number.parseFloat(v)>=1.9)).toBeTruthy();
	await trigger.click(); await expect(trigger).toHaveAttribute("aria-expanded","false");
	await expect(panel).toHaveAttribute("aria-hidden","true");
	await expect(panel).toHaveAttribute("inert","");
	await trigger.click(); await expect(trigger).toHaveAttribute("aria-expanded","true");
});

test("reduced motion removes the 2s transition", async ({page})=>{
	await page.emulateMedia({reducedMotion:"reduce"}); await mockAccess(page); await page.goto("/");
	const panel=await openProfile(page);
	const duration=await panel.evaluate(el=>getComputedStyle(el).transitionDuration);
	expect(duration.split(",").every(v=>Number.parseFloat(v.trim())===0)).toBeTruthy();
	await closeProfile(page); await expect(page.locator(".global-profile-panel")).toHaveCount(0);
});

test("unified panel preserves compact icon-first density and responsive containment", async ({page})=>{
	await page.emulateMedia({reducedMotion:"reduce"}); await mockAccess(page,{capabilities:allToolCapabilities}); await page.goto("/");
	for(const viewport of [{width:320,height:800},{width:390,height:844},{width:683,height:384},{width:1366,height:768},{width:1920,height:1080},{width:2560,height:1440}]){
		await page.setViewportSize(viewport); const panel=await openProfile(page); await expectNoHorizontalOverflow(page); await expectPanelContained(page,".global-profile-panel");
		const cols=await panel.locator(".product-launcher-grid").first().evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(/\s+/u).filter(Boolean).length);
		expect(cols).toBe(viewport.width<=360?2:3);
		const link=panel.getByRole("link",{name:"Editar sessões",exact:true}); const icon=link.locator(".product-launcher-item-icon");
		const [lb,ib]=await Promise.all([link.boundingBox(),icon.boundingBox()]); expect(lb).not.toBeNull(); expect(ib).not.toBeNull();
		if(lb) expect(lb.height).toBeLessThan(90); if(ib){expect(ib.width).toBeGreaterThanOrEqual(30);expect(ib.height).toBeGreaterThanOrEqual(30);}
		if(viewport.width>=768){const pb=await panel.boundingBox(); if(pb)expect(pb.width).toBeLessThanOrEqual(502);}
		await closeProfile(page);
	}
});

test("short viewport scrolls inside the unified panel", async ({page})=>{
	await page.emulateMedia({reducedMotion:"reduce"}); await mockAccess(page,{capabilities:allToolCapabilities}); await page.setViewportSize({width:390,height:500}); await page.goto("/");
	const panel=await openProfile(page); const state=await panel.evaluate(el=>({clientHeight:el.clientHeight,scrollHeight:el.scrollHeight,overflowY:getComputedStyle(el).overflowY}));
	expect(state.scrollHeight).toBeGreaterThan(state.clientHeight); expect(state.overflowY).toBe("auto"); expect(await page.evaluate(()=>window.scrollY)).toBe(0);
});

test("appearance control toggles the explicit document theme", async ({page})=>{
	await page.emulateMedia({colorScheme:"dark",reducedMotion:"reduce"}); await mockAccess(page,{state:"anonymous"}); await page.goto("/");
	const panel=await openProfile(page); const theme=panel.getByRole("switch",{name:"Modo escuro"}); await expect(theme).toHaveAttribute("aria-checked","true"); await theme.click(); await expect(page.locator("html")).toHaveAttribute("data-theme","light");
});

test("unified navigation receipts are synthetic in desktop/mobile dark/light", async ({page},testInfo)=>{
	await page.emulateMedia({reducedMotion:"reduce"}); await mockAccess(page,{capabilities:allToolCapabilities});
	for(const receipt of [
		{name:"desktop-dark",viewport:{width:1920,height:1080},colorScheme:"dark" as const},
		{name:"desktop-light",viewport:{width:1920,height:1080},colorScheme:"light" as const},
		{name:"mobile-dark",viewport:{width:390,height:844},colorScheme:"dark" as const},
		{name:"mobile-light",viewport:{width:390,height:844},colorScheme:"light" as const},
	]){
		await page.setViewportSize(receipt.viewport); await page.emulateMedia({colorScheme:receipt.colorScheme,reducedMotion:"reduce"}); await page.goto("/"); await openProfile(page);
		await page.screenshot({path:testInfo.outputPath(`navigation-${receipt.name}.png`),fullPage:false});
	}
});

test("account overview keeps synthetic identity and access usable across the layout matrix", async ({
	page,
	context,
}, testInfo) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);

	for (const state of [
		{
			query: "anonymous",
			status: "Não autenticada",
			body: "Entre com o Discord para consultar seu perfil TDA.",
		},
		{
			query: "unavailable",
			status: "Acesso indisponível",
			body: "Não foi possível consultar seu perfil TDA agora.",
		},
		{
			query: "unlinked",
			status: "Não vinculada",
			body: "Ainda sem perfil TDA vinculado.",
		},
		{
			query: "no-grants",
			status: "Sem permissões nesta campanha",
			body: "Nenhuma permissão efetiva nesta campanha.",
		},
	]) {
		await page.goto(`/e2e-fixtures/account-overview?state=${state.query}`);
		await expect(page.getByText(state.status, { exact: true })).toBeVisible();
		await expect(page.getByText(state.body, { exact: false })).toBeVisible();
		await expect(page.locator("body")).not.toContainText(
			"auth-synthetic-never-rendered",
		);
	}

	for (const viewport of [
		{ width: 320, height: 800 },
		{ width: 390, height: 844 },
		{ width: 768, height: 1024 },
		{ width: 1366, height: 768 },
		{ width: 1920, height: 1080 },
	]) {
		await page.setViewportSize(viewport);
		await page.goto("/e2e-fixtures/account-overview");
		await expect(
			page.getByRole("heading", { name: "Conta e acesso", exact: true }),
		).toBeVisible();
		await expect(page.getByText("Pessoa Sintética", { exact: true })).toBeVisible();
		await expect(page.getByText("profile-tda-synthetic-927", { exact: true })).toBeVisible();
		await expect(
			page.getByRole("heading", { name: "Permissões nesta campanha", exact: true }),
		).toBeVisible();
		await expect(page.getByText("Gerenciar permissões", { exact: true })).toBeVisible();
		await expect(page.getByText("campaign/yuhara-main", { exact: true })).toHaveCount(0);
		await expect(page.getByRole("link", { name: "Ver histórias públicas" })).toHaveCount(0);
		await expect(page.locator('form[action="/auth/logout"]')).toHaveAttribute("method", "post");
		await expectNoHorizontalOverflow(page);
	}

	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/e2e-fixtures/account-overview");
	const copyId = page.getByRole("button", { name: "Copiar ID" });
	await copyId.focus();
	await expect(copyId).toBeFocused();
	await copyId.press("Enter");
	await expect(page.getByText("ID copiado.", { exact: true })).toBeVisible();
	await copyId.click();
	await expect(page.getByText("ID copiado.", { exact: true })).toBeVisible();

	for (const receipt of [
		{
			name: "navigation-desktop-dark",
			viewport: { width: 1920, height: 1080 },
			colorScheme: "dark" as const,
		},
		{
			name: "navigation-desktop-light",
			viewport: { width: 1920, height: 1080 },
			colorScheme: "light" as const,
		},
		{
			name: "navigation-mobile-dark",
			viewport: { width: 390, height: 844 },
			colorScheme: "dark" as const,
		},
		{
			name: "navigation-mobile-light",
			viewport: { width: 390, height: 844 },
			colorScheme: "light" as const,
		},
	]) {
		await page.setViewportSize(receipt.viewport);
		await page.emulateMedia({ colorScheme: receipt.colorScheme });
		await page.goto("/e2e-fixtures/account-overview");
		await page.screenshot({
			path: testInfo.outputPath(`${receipt.name}.png`),
			fullPage: false,
		});
	}
});

