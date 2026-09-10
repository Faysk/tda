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
