import { expect, test } from "@playwright/test";
import {
	fixtureJob,
	installCompanionFixture,
} from "../processing/companion-fixture";

function logEvent(
	seq: number,
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		seq,
		at: `2026-09-27T21:00:${String(seq % 60).padStart(2, "0")}Z`,
		code: "TRACK_PROGRESS",
		level: "info",
		attempt: 1,
		data: { track: 1, marker: `routine-${seq}` },
		...overrides,
	};
}

function eventReads(state: Awaited<ReturnType<typeof installCompanionFixture>>) {
	return state.requests.filter(
		(request) =>
			request.method === "GET" &&
			request.path === "/jobs/craig-job-1/events",
	).length;
}

async function openLiveLog(
	page: import("@playwright/test").Page,
	options: Parameters<typeof installCompanionFixture>[1] = {},
) {
	await page.setViewportSize({ width: 1440, height: 900 });
	const state = await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: [fixtureJob("running")],
		jobEvents: [logEvent(1)],
		...options,
	});
	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "Diagnóstico" }).click();
	await expect(page.getByRole("button", { name: "Humanizada" })).toHaveAttribute("aria-pressed", "true");
	await expect(page.locator('button[data-event-seq="1"]')).toBeVisible();
	return state;
}

test("humanized live log paces routine rows while factual inspection and urgent catch-up stay immediate", async ({
	page,
}, testInfo) => {
	const state = await openLiveLog(page);
	const firstReadCount = eventReads(state);

	state.setJobEvents([
		logEvent(1),
		...Array.from({ length: 6 }, (_, index) => logEvent(index + 2)),
	]);

	await expect
		.poll(() => eventReads(state), { timeout: 2_500 })
		.toBeGreaterThan(firstReadCount);
	await expect(
		page.locator('button[data-event-seq="2"]'),
	).toBeVisible({ timeout: 350 });
	await expect(
		page.locator('button[data-event-seq="7"]'),
	).toHaveCount(0);

	await expect(page.locator('button[data-event-seq="2"]')).toBeVisible();

	await page.screenshot({
		path: testInfo.outputPath("live-log-paced-window.png"),
		fullPage: true,
	});

	// Search is inspection, so it reads the complete factual buffer immediately,
	// even while seq 7 has not yet reached the visual reveal cutoff.
	const search = page.getByPlaceholder("Buscar código, voz ou etapa…");
	await search.fill("routine-7");
	await expect(
		page.locator('button[data-event-seq="7"]'),
	).toBeVisible({ timeout: 250 });
	await search.fill("");

	await expect(
		page.locator('button[data-event-seq="7"]'),
	).toBeVisible({ timeout: 1_500 });

	const urgentReadCount = eventReads(state);
	state.setJobEvents([
		logEvent(1),
		...Array.from({ length: 7 }, (_, index) => logEvent(index + 2)),
		logEvent(9, {
			code: "WORKER_RESULT_TEARDOWN_FORCED",
			level: "warning",
			data: { marker: "urgent-warning" },
		}),
		logEvent(10, { data: { track: 1, marker: "tail-10" } }),
	]);

	await expect
		.poll(() => eventReads(state), { timeout: 2_500 })
		.toBeGreaterThan(urgentReadCount);
	await expect(
		page.locator('button[data-event-seq="9"]'),
	).toBeVisible({ timeout: 350 });
	await expect(
		page.locator('button[data-event-seq="10"]'),
	).toBeVisible({ timeout: 350 });

	await page.screenshot({
		path: testInfo.outputPath("live-log-urgent-bypass.png"),
		fullPage: true,
	});

	await page.getByRole("button", { name: "Pausar visualização" }).click();
	const pausedReadCount = eventReads(state);
	state.setJobEvents([
		logEvent(1),
		...Array.from({ length: 9 }, (_, index) => logEvent(index + 2)),
		logEvent(11, { data: { track: 1, marker: "paused-11" } }),
	]);
	await expect
		.poll(() => eventReads(state), { timeout: 2_500 })
		.toBeGreaterThan(pausedReadCount);
	await expect(
		page.locator('button[data-event-seq="11"]'),
	).toHaveCount(0);

	// Pausing freezes only presentation. Factual search still sees seq 11.
	await search.fill("paused-11");
	await expect(
		page.locator('button[data-event-seq="11"]'),
	).toBeVisible({ timeout: 250 });
	await search.fill("");
	await expect(
		page.locator('button[data-event-seq="11"]'),
	).toHaveCount(0);

	const catchUp = page.getByRole("button", {
		name: /1 novos eventos · Voltar ao vivo/,
	});
	await expect(catchUp).toBeVisible();
	await catchUp.click();
	await expect(
		page.locator('button[data-event-seq="11"]'),
	).toBeVisible({ timeout: 250 });

	await page.screenshot({
		path: testInfo.outputPath("live-log-caught-up.png"),
		fullPage: true,
	});
});

test("technical mode bypasses cosmetic pacing and exposes the factual tail immediately", async ({
	page,
}) => {
	const state = await openLiveLog(page);
	await page.getByRole("button", { name: "Técnica", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Técnica", exact: true }),
	).toHaveAttribute("aria-pressed", "true");

	const firstReadCount = eventReads(state);
	state.setJobEvents([
		logEvent(1),
		logEvent(2),
		logEvent(3),
		logEvent(4),
		logEvent(5),
	]);

	await expect
		.poll(() => eventReads(state), { timeout: 2_500 })
		.toBeGreaterThan(firstReadCount);
	await expect(page.locator('button[data-event-seq="5"]')).toBeVisible({
		timeout: 350,
	});
	await expect(page.getByRole("log").locator("button[data-event-seq]")).toHaveCount(5);
	await expect(
		page.getByText("TRACK_PROGRESS · seq 5", { exact: true }),
	).toBeVisible();
});

test("reduced motion reveals the complete factual batch without cosmetic pacing", async ({
	page,
}, testInfo) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	const state = await openLiveLog(page);
	const firstReadCount = eventReads(state);

	state.setJobEvents([
		logEvent(1),
		logEvent(2),
		logEvent(3),
		logEvent(4),
		logEvent(5),
	]);

	await expect
		.poll(() => eventReads(state), { timeout: 2_500 })
		.toBeGreaterThan(firstReadCount);
	await expect(
		page.locator('button[data-event-seq="5"]'),
	).toBeVisible({ timeout: 350 });
	expect(
		await page
			.locator('button[data-event-seq="5"]')
			.evaluate((node) => getComputedStyle(node).animationName),
	).toBe("none");

	await page.screenshot({
		path: testInfo.outputPath("live-log-reduced-motion.png"),
		fullPage: true,
	});
});
