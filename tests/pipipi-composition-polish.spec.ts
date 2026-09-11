import { expect, test } from "@playwright/test";

const bedScenes = [
	{
		id: "super-herois",
		title: "Os super-heróis não vieram salvá-la",
		artwork: "/lore/pipipi/super-static.webp",
	},
	{
		id: "cadeira",
		title: "A cadeira",
		artwork: "/lore/pipipi/cadeira-static.webp",
	},
	{
		id: "ultimo-dia",
		title: "O último dia",
		artwork: "/lore/pipipi/ultimo-dia-static.webp",
	},
] as const;

const sourceResolution = { width: 1672, height: 941 } as const;

test("renders the three approved bed scenes as source-resolution single static frames", async ({
	page,
}) => {
	await page.goto("/lore/pipipi");

	for (const expected of bedScenes) {
		const scene = page.locator(`[data-scene="${expected.id}"]`);
		await scene.scrollIntoViewIfNeeded();

		await expect(scene).toHaveAttribute("data-static-media", "true");
		await expect(scene).toHaveAttribute("data-static-artwork", expected.artwork);

		const mediaImages = scene.locator('div[aria-hidden="true"] > img');
		await expect(mediaImages).toHaveCount(1);
		await expect(mediaImages.first()).toBeVisible();
		await expect(mediaImages.first()).toHaveAttribute("src", expected.artwork);
		await expect
			.poll(() =>
				mediaImages.first().evaluate((element) => {
					const image = element as HTMLImageElement;
					return { width: image.naturalWidth, height: image.naturalHeight };
				}),
			)
			.toEqual(sourceResolution);

		const motionBefore = await scene.evaluate((element) => {
			const style = getComputedStyle(element);
			return {
				x: style.getPropertyValue("--scene-bg-x").trim(),
				y: style.getPropertyValue("--scene-bg-y").trim(),
				scale: style.getPropertyValue("--scene-bg-scale").trim(),
			};
		});
		expect(motionBefore, `${expected.id} static motion`).toEqual({
			x: "0px",
			y: "0px",
			scale: "1",
		});

		await page.mouse.wheel(0, 240);
		await page.waitForTimeout(80);

		const motionAfter = await scene.evaluate((element) => {
			const style = getComputedStyle(element);
			return {
				x: style.getPropertyValue("--scene-bg-x").trim(),
				y: style.getPropertyValue("--scene-bg-y").trim(),
				scale: style.getPropertyValue("--scene-bg-scale").trim(),
			};
		});
		expect(motionAfter, `${expected.id} stays static`).toEqual(motionBefore);
	}
});

test("keeps corridor characters clear and moves editorial copy to the right", async ({
	page,
}, testInfo) => {
	test.skip(testInfo.project.name === "mobile", "mobile keeps the approved copy layout");

	await page.goto("/lore/pipipi");
	const scene = page.locator('[data-scene="corredores"]');
	await scene.scrollIntoViewIfNeeded();

	const copy = scene
		.getByRole("heading", { name: "Algumas crianças nunca foram para casa" })
		.locator("..");
	const subject = scene.locator('div[aria-hidden="true"] > img').nth(1);

	const viewport = page.viewportSize();
	const copyBox = await copy.boundingBox();
	const subjectBox = await subject.boundingBox();
	expect(viewport).not.toBeNull();
	expect(copyBox).not.toBeNull();
	expect(subjectBox).not.toBeNull();
	if (!viewport || !copyBox || !subjectBox) return;

	expect(copyBox.x).toBeGreaterThan(viewport.width * 0.55);
	expect(subjectBox.x + subjectBox.width * 0.72).toBeLessThan(copyBox.x);

	const shade = scene.locator('div[aria-hidden="true"] > div').first();
	const shadeBackground = await shade.evaluate(
		(element) => getComputedStyle(element).backgroundImage,
	);
	expect(shadeBackground).toContain("270deg");
});
