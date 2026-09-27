import { expect, test } from "@playwright/test";
import {
	fixtureBenchmarkJob,
	installCompanionFixture,
} from "./companion-fixture";

const READY_PROFILES = [
	"whisper-turbo",
	"whisper-detailed",
	"qwen-fast",
	"qwen-quality",
];

function syntheticZip(name = "craig-session.zip") {
	return {
		name,
		mimeType: "application/zip",
		buffer: Buffer.from("PK synthetic benchmark fixture"),
	};
}

async function openBenchmark(
	page: import("@playwright/test").Page,
	options: Parameters<typeof installCompanionFixture>[1] = {},
) {
	await installCompanionFixture(page, {
		benchmarkProfiles: true,
		advanceJobs: false,
		...options,
	});
	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "Benchmark" }).click();
	return page.getByRole("tabpanel", { name: "Benchmark" });
}

test("benchmark preflight exposes source, readiness and one actionable next step", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1920, height: 1080 });
	const benchmark = await openBenchmark(page, {
		benchmarkReadyProfiles: READY_PROFILES,
	});

	const source = benchmark.getByRole("region", { name: "Fonte do benchmark" });
	const readiness = benchmark.getByRole("region", {
		name: "Prontidão dos perfis",
	});
	const input = benchmark.getByLabel("ZIP Craig");

	await expect(source).toBeVisible();
	await expect(readiness).toBeVisible();
	const nativeInputBox = await input.boundingBox();
	expect(nativeInputBox?.width ?? 99).toBeLessThanOrEqual(1);
	expect(nativeInputBox?.height ?? 99).toBeLessThanOrEqual(1);
	await expect(
		benchmark.getByRole("button", { name: "Selecionar ZIP" }),
	).toBeVisible();
	await expect(
		benchmark.getByRole("button", { name: "Executar benchmark de 5 minutos" }),
	).toHaveCount(0);

	await input.setInputFiles(
		syntheticZip(
			"craig-session-with-a-very-long-name-that-must-never-expand-the-benchmark-layout-beyond-the-viewport.zip",
		),
	);
	await expect(
		benchmark.getByText(
			"craig-session-with-a-very-long-name-that-must-never-expand-the-benchmark-layout-beyond-the-viewport.zip",
			{ exact: true },
		),
	).toBeVisible();
	await expect(
		benchmark.getByRole("button", { name: "Analisar amostra localmente" }),
	).toBeVisible();

	await benchmark.getByRole("button", { name: "Analisar amostra localmente" }).click();
	await expect(benchmark.getByText("Verificada agora", { exact: true })).toBeVisible();
	await expect(
		benchmark.getByRole("button", { name: "Executar benchmark de 5 minutos" }),
	).toBeVisible();
	await expect(
		benchmark.getByRole("button", { name: /Preparar .* perfis pendentes/ }),
	).toHaveCount(0);

	const [sourceBox, readinessBox, actionBox, historyBox] = await Promise.all([
		source.boundingBox(),
		readiness.boundingBox(),
		benchmark.getByText("Próxima ação", { exact: true }).boundingBox(),
		benchmark.locator("[data-benchmark-history='true']").boundingBox(),
	]);
	expect(sourceBox).not.toBeNull();
	expect(readinessBox).not.toBeNull();
	expect(actionBox).not.toBeNull();
	expect(historyBox).not.toBeNull();
	expect(Math.abs((sourceBox?.y ?? 0) - (readinessBox?.y ?? 0))).toBeLessThanOrEqual(2);
	expect((actionBox?.y ?? 9999)).toBeLessThan(1080);
	expect((historyBox?.height ?? 9999)).toBeLessThan(140);

	const geometry = await page.evaluate(() => ({
		scrollWidth: document.documentElement.scrollWidth,
		clientWidth: document.documentElement.clientWidth,
	}));
	expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
});

test("benchmark readiness makes preparation the primary action instead of a dead run button", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	const benchmark = await openBenchmark(page, {
		benchmarkReadyProfiles: ["whisper-turbo"],
	});

	const input = benchmark.getByLabel("ZIP Craig");
	await input.setInputFiles(syntheticZip());
	await benchmark.getByRole("button", { name: "Analisar amostra localmente" }).click();

	await expect(
		benchmark.getByRole("button", { name: "Preparar 3 perfis pendentes" }),
	).toBeVisible();
	await expect(
		benchmark.getByRole("button", { name: "Executar benchmark de 5 minutos" }),
	).toHaveCount(0);
	await expect(benchmark.getByText("1 / 4 perfis prontos", { exact: true })).toBeVisible();
});

for (const viewport of [
	{ width: 320, height: 568 },
	{ width: 390, height: 844 },
	{ width: 960, height: 540 },
]) {
	test(`benchmark preflight reflows without horizontal overflow at ${viewport.width}x${viewport.height}`, async ({
		page,
	}) => {
		await page.setViewportSize(viewport);
		const benchmark = await openBenchmark(page, {
			benchmarkReadyProfiles: READY_PROFILES,
		});
		const input = benchmark.getByLabel("ZIP Craig");
		await input.setInputFiles(
			syntheticZip(
				"this-is-an-extremely-long-craig-export-filename-used-to-prove-that-the-selected-file-state-truncates-safely.zip",
			),
		);

		const source = benchmark.getByRole("region", { name: "Fonte do benchmark" });
		const readiness = benchmark.getByRole("region", {
			name: "Prontidão dos perfis",
		});
		const [sourceBox, readinessBox] = await Promise.all([
			source.boundingBox(),
			readiness.boundingBox(),
		]);
		expect(sourceBox).not.toBeNull();
		expect(readinessBox).not.toBeNull();
		expect(readinessBox?.y ?? 0).toBeGreaterThanOrEqual(
			(sourceBox?.y ?? 0) + (sourceBox?.height ?? 0) - 1,
		);

		const geometry = await page.evaluate(() => ({
			scrollWidth: document.documentElement.scrollWidth,
			clientWidth: document.documentElement.clientWidth,
		}));
		expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
	});
}

test("active benchmark shows compact four-profile progress and operational actions", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1920, height: 1080 });
	const benchmark = await openBenchmark(page, {
		benchmarkReadyProfiles: READY_PROFILES,
		initialJobs: [fixtureBenchmarkJob("running")],
	});

	const active = benchmark.locator("[data-benchmark-active='true']");
	await expect(active).toBeVisible();
	const progress = active.getByRole("progressbar", { name: "Perfis concluídos" });
	await expect(progress).toHaveAttribute("aria-valuemin", "0");
	await expect(progress).toHaveAttribute("aria-valuemax", "4");
	await expect(progress).toHaveAttribute("aria-valuenow", "1");
	await expect(active.locator("[aria-current='step']")).toContainText("Whisper Detailed");
	await expect(
		active.getByRole("button", { name: "Ver log / Diagnóstico" }),
	).toBeVisible();
	await expect(
		active.getByRole("button", { name: "Cancelar benchmark" }),
	).toBeVisible();
});
