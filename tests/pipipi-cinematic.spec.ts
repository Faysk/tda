import { expect, test } from "@playwright/test";

const sceneIds = [
	"casa",
	"super-herois",
	"corredores",
	"cadeira",
	"ultimo-dia",
	"acordou",
] as const;

const runtimeAssets = [
	"acordou-bg.avif",
	"acordou-subject.avif",
	"cadeira-bg.avif",
	"cadeira-subject.avif",
	"casa-bg.avif",
	"casa-subject.avif",
	"corredores-bg.avif",
	"corredores-subject.avif",
	"ghost-cry.avif",
	"ghost-flute.avif",
	"ghost-hearts.avif",
	"ghost-soft.avif",
	"ghost-surprise.avif",
	"stage-bg.avif",
	"super-bg.avif",
	"super-subject.avif",
	"ultimo-dia-bg.avif",
	"ultimo-dia-subject.avif",
] as const;

test("renders the approved Pipipi cinematic structure", async ({ page }) => {
	const response = await page.goto("/lore/pipipi");
	expect(response?.status()).toBe(200);

	await expect(page.getByRole("heading", { level: 1 })).toContainText(
		"A Casa Onde os Super-Heróis Visitavam",
	);
	await expect(
		page
			.getByRole("navigation", { name: "Capítulos da história" })
			.getByRole("link"),
	).toHaveCount(3);
	await expect(
		page.getByRole("heading", { name: "Pipipi não mentiu nenhuma vez." }),
	).toBeVisible();
	await expect(
		page
			.getByText("Quando você não consegue salvar alguém, ainda pode ficar.", {
				exact: true,
			})
			.last(),
	).toBeVisible();

	await expect(page.locator("main")).toHaveCount(1);

	const heroHeight = await page.locator("#topo").evaluate((element) =>
		element.getBoundingClientRect().height,
	);
	const viewportHeight = page.viewportSize()?.height ?? 1;
	expect(heroHeight).toBeGreaterThanOrEqual(viewportHeight * 0.8);

	const renderedSceneIds = await page
		.locator("[data-scene]")
		.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-scene")));
	expect(renderedSceneIds).toEqual(sceneIds);

	const infiniteAnimations = await page.locator("article").evaluate((article) =>
		Array.from(article.querySelectorAll("*")).filter((element) =>
			getComputedStyle(element)
				.animationIterationCount.split(",")
				.some((count) => count.trim() === "infinite"),
		).length,
	);
	expect(infiniteAnimations).toBe(0);
});

test("makes published cinematic lores discoverable without crowding mobile navigation", async ({ page }, testInfo) => {
	await page.goto("/");
	const primaryNav = page.getByRole("navigation", { name: "Navegação principal" });
	const navLoresLink = primaryNav.locator('a.lore-nav-link');
	await expect(navLoresLink).toHaveAttribute("href", "/lore");

	if (testInfo.project.name === "mobile") {
		await expect(navLoresLink).toBeHidden();
		const homeLoresLink = page.getByRole("link", { name: /Explorar lores/ });
		await expect(homeLoresLink).toBeVisible();
		await expect(homeLoresLink).toHaveAttribute("href", "/lore");
		await homeLoresLink.click();
	} else {
		await expect(navLoresLink).toBeVisible();
		await navLoresLink.click();
	}

	await expect(page).toHaveURL(/\/lore$/);
	await expect(
		page.getByRole("heading", { level: 1, name: "Histórias que ganharam outro palco." }),
	).toBeVisible();
	await expect(
		page.getByRole("link").filter({ hasText: "A Casa Onde os Super-Heróis Visitavam" }),
	).toHaveAttribute("href", "/lore/pipipi");
});

test("keeps the three chapter links inside the mobile viewport", async ({ page }, testInfo) => {
	test.skip(testInfo.project.name !== "mobile", "chapter compaction is a mobile contract");
	await page.goto("/lore/pipipi");

	const nav = page.getByRole("navigation", { name: "Capítulos da história" });
	await expect(nav).toBeVisible();
	const navMetrics = await nav.evaluate((element) => ({
		clientWidth: element.clientWidth,
		scrollWidth: element.scrollWidth,
		left: element.getBoundingClientRect().left,
		right: element.getBoundingClientRect().right,
	}));
	const viewportWidth = page.viewportSize()?.width ?? 1;
	expect(navMetrics.scrollWidth).toBeLessThanOrEqual(navMetrics.clientWidth + 1);
	expect(navMetrics.left).toBeGreaterThanOrEqual(0);
	expect(navMetrics.right).toBeLessThanOrEqual(viewportWidth + 1);

	for (const link of await nav.getByRole("link").all()) {
		const box = await link.boundingBox();
		expect(box).not.toBeNull();
		if (!box) continue;
		expect(box.x).toBeGreaterThanOrEqual(navMetrics.left - 1);
		expect(box.x + box.width).toBeLessThanOrEqual(navMetrics.right + 1);
	}
});

test("serves every pinned AVIF runtime asset", async ({ request }, testInfo) => {
	test.skip(
		testInfo.project.name !== "desktop-1080p",
		"asset integrity only needs one browser project",
	);

	for (const asset of runtimeAssets) {
		const response = await request.get(`/lore/pipipi/${asset}`);
		expect(response.status(), asset).toBe(200);
		expect(response.headers()["content-type"], asset).toContain("image/avif");
	}
});

test("keeps cinematic copy legible without JavaScript", async ({ browser }, testInfo) => {
	test.skip(
		testInfo.project.name !== "desktop-1080p",
		"the static fallback only needs one browser project",
	);

	const context = await browser.newContext({ javaScriptEnabled: false });
	const page = await context.newPage();
	const response = await page.goto("/lore/pipipi");
	expect(response?.status()).toBe(200);

	const copy = page
		.locator('[data-scene="corredores"]')
		.getByRole("heading", {
			name: "Algumas crianças nunca foram para casa",
			exact: true,
		})
		.locator("..");
	await expect(copy).toBeVisible();
	expect(
		await copy.evaluate((element) => Number.parseFloat(getComputedStyle(element).opacity)),
	).toBe(1);

	await context.close();
});

test("keeps editorial display headings inside their own column", async ({ page }, testInfo) => {
	test.skip(testInfo.project.name === "mobile", "mobile uses a single-column editorial layout");
	await page.goto("/lore/pipipi");

	for (const sectionId of [
		"minha-mae-trabalhava-demais",
		"pipipi-e-dandelion",
		"a-pulseirinha",
	]) {
		const section = page.locator(`#${sectionId}`);
		await section.scrollIntoViewIfNeeded();
		const headingBox = await section.getByRole("heading", { level: 2 }).boundingBox();
		const proseBox = await section.locator(":scope > div").boundingBox();
		expect(headingBox, `${sectionId}: heading box`).not.toBeNull();
		expect(proseBox, `${sectionId}: prose box`).not.toBeNull();
		if (!headingBox || !proseBox) continue;

		expect(
			headingBox.x + headingBox.width,
			`${sectionId}: heading must not enter prose column`,
		).toBeLessThanOrEqual(proseBox.x - 8);
	}
});

test("uses portrait focal points and keeps the flying Pipipi inside the stage", async ({ page }, testInfo) => {
	test.skip(testInfo.project.name !== "mobile", "portrait art direction is a mobile contract");
	await page.goto("/lore/pipipi");

	const chairScene = page.locator('[data-scene="cadeira"]');
	await chairScene.scrollIntoViewIfNeeded();
	const chairObjectPosition = await chairScene
		.locator("img")
		.first()
		.evaluate((image) => getComputedStyle(image).objectPosition);
	expect(chairObjectPosition).toBe("72% 50%");

	const wokeScene = page.locator('[data-scene="acordou"]');
	await wokeScene.scrollIntoViewIfNeeded();
	await expect(wokeScene).toHaveAttribute("data-active", "true");
	await wokeScene.evaluate((element) => {
		const rect = element.getBoundingClientRect();
		const absoluteTop = window.scrollY + rect.top;
		window.scrollTo(
			0,
			absoluteTop + Math.max(1, rect.height - window.innerHeight) * 0.5,
		);
	});

	await expect
		.poll(async () =>
			Number.parseFloat(
				(await wokeScene.evaluate((element) =>
					element.style.getPropertyValue("--scene-progress"),
				)) || "0",
			),
		)
		.toBeGreaterThan(0.2);

	const stageBox = await wokeScene.locator(":scope > div").boundingBox();
	const subjectBox = await wokeScene.locator("img").nth(1).boundingBox();
	expect(stageBox).not.toBeNull();
	expect(subjectBox).not.toBeNull();
	if (stageBox && subjectBox) {
		expect(subjectBox.x).toBeGreaterThanOrEqual(stageBox.x - 1);
		expect(subjectBox.x + subjectBox.width).toBeLessThanOrEqual(
			stageBox.x + stageBox.width + 1,
		);
	}

	const mobileBackgroundX = Number.parseFloat(
		(await wokeScene.evaluate((element) => element.style.getPropertyValue("--scene-bg-x"))) ||
			"0",
	);
	expect(Math.abs(mobileBackgroundX)).toBeLessThanOrEqual(0.5);
});

test("runs finite viewport-driven motion and honors reduced motion", async ({ page }) => {
	await page.goto("/lore/pipipi");
	const scene = page.locator('[data-scene="corredores"]');

	await scene.scrollIntoViewIfNeeded();
	await expect(scene).toHaveAttribute("data-active", "true");

	const stageHeight = await scene
		.locator(":scope > div")
		.evaluate((element) => element.getBoundingClientRect().height);
	const viewportHeight = page.viewportSize()?.height ?? 1;
	expect(stageHeight).toBeGreaterThanOrEqual(viewportHeight * 0.95);

	await scene.evaluate((element) => {
		const rect = element.getBoundingClientRect();
		const absoluteTop = window.scrollY + rect.top;
		window.scrollTo(
			0,
			absoluteTop + Math.max(1, rect.height - window.innerHeight) * 0.55,
		);
	});

	await expect
		.poll(async () =>
			Number.parseFloat(
				(await scene.evaluate((element) =>
					element.style.getPropertyValue("--scene-progress"),
				)) || "0",
			),
		)
		.toBeGreaterThan(0.25);

	await page.emulateMedia({ reducedMotion: "reduce" });
	await expect
		.poll(async () =>
			scene.evaluate((element) =>
				element.style.getPropertyValue("--scene-progress"),
			),
		)
		.toBe("0");
	await expect
		.poll(async () =>
			scene.evaluate((element) =>
				element.style.getPropertyValue("--scene-subject-y"),
			),
		)
		.toBe("0px");
	await expect
		.poll(async () =>
			scene.evaluate((element) =>
				element.style.getPropertyValue("--scene-copy-opacity"),
			),
		)
		.toBe("1");

	const stagePosition = await scene
		.locator(":scope > div")
		.evaluate((element) => getComputedStyle(element).position);
	expect(stagePosition).toBe("relative");
});
