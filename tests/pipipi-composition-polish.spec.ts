import { expect, test } from "@playwright/test";

const bedScenes = [
	{
		id: "super-herois",
		title: "Os super-heróis não vieram salvá-la",
		leftRatio: 0.03984375,
		widthRatio: 0.425,
	},
	{
		id: "cadeira",
		title: "A cadeira",
		leftRatio: 0.07734375,
		widthRatio: 0.49296875,
	},
	{
		id: "ultimo-dia",
		title: "O último dia",
		leftRatio: 0.1734375,
		widthRatio: 0.425,
	},
] as const;

test("registers the three bed cutouts back onto their source frame", async ({
	page,
}, testInfo) => {
	test.skip(testInfo.project.name === "mobile", "desktop source-frame registration");

	await page.goto("/lore/pipipi");
	const viewport = page.viewportSize();
	expect(viewport).not.toBeNull();
	if (!viewport) return;

	for (const expected of bedScenes) {
		const scene = page.locator(`[data-scene="${expected.id}"]`);
		await scene.scrollIntoViewIfNeeded();

		const mediaImages = scene.locator('div[aria-hidden="true"] > img');
		const background = mediaImages.nth(0);
		const subject = mediaImages.nth(1);

		await expect(background).toBeVisible();
		await expect(subject).toBeVisible();

		const backgroundTransform = await background.evaluate(
			(element) => getComputedStyle(element).transform,
		);
		expect(backgroundTransform, `${expected.id} background`).toBe("none");

		const subjectBox = await subject.boundingBox();
		expect(subjectBox, `${expected.id} subject box`).not.toBeNull();
		if (!subjectBox) continue;

		expect(
			Math.abs(subjectBox.width / viewport.width - expected.widthRatio),
			`${expected.id} source width`,
		).toBeLessThan(0.012);
		expect(
			Math.abs(subjectBox.x / viewport.width - expected.leftRatio),
			`${expected.id} source x`,
		).toBeLessThan(0.012);

		const maskImage = await subject.evaluate((element) => {
			const style = getComputedStyle(element);
			return style.maskImage || style.webkitMaskImage;
		});
		expect(maskImage, `${expected.id} bed-edge blend`).not.toBe("none");
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
