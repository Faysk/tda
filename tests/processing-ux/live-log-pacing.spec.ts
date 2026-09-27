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

function eventReads(
	state: Awaited<ReturnType<typeof installCompanionFixture>>,
): number {
	return state.requests.filter(
		(request) =>
			request.method === "GET" &&
			request.path === "/jobs/craig-job-1/events",
	).length;
}

async function openLiveLog(page: import("@playwright/test").Page) {
	await page.setViewportSize({ width: 1440, height: 900 });
	const state = await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		initialJobs: [fixtureJob("running")],
		jobEvents: [logEvent(1)],
	});
	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "Diagnóstico" }).click();
	const explorer = page.getByRole("region", {
		name: "Explorador de eventos do processamento",
	});
	const log = explorer.getByRole("log");
	await expect(log.locator('[data-event-seq="1"]')).toBeVisible();
	return { state, explorer, log };
}

test("Live Log paces routine batches, exposes factual search immediately, and catches up without replay", async ({
	page,
}, testInfo) => {
	const { state, log } = await openLiveLog(page);
	const initialReads = eventReads(state);

	state.setJobEvents([
		logEvent(1),
		logEvent(2),
		logEvent(3),
		logEvent(4),
		logEvent(5),
		logEvent(6),
		logEvent(7),
	]);

	await expect
		.poll(() => eventReads(state), { timeout: 2_500 })
		.toBeGreaterThan(initialReads);

	// The first routine row is revealed immediately, while the tail remains paced
	// inside the active 1.5 s polling window.
	await expect(log.locator('[data-event-seq="2"]')).toBeVisible({
		timeout: 350,
	});
	await expect(log.locator('[data-event-seq="7"]')).toHaveCount(0);
	await page.screenshot({
		path: testInfo.outputPath("live-log-paced-start.png"),
		fullPage: true,
	});

	// Search operates on the complete factual buffer, not only the visual tail.
	const search = page.getByPlaceholder("Buscar code, speaker, stage…");
	await search.fill("routine-7");
	await expect(log.locator('[data-event-seq="7"]')).toBeVisible({
		timeout: 250,
	});
	await search.fill("");

	await expect(log.locator('[data-event-seq="7"]')).toBeVisible({
		timeout: 1_500,
	});

	const warningReads = eventReads(state);
	state.setJobEvents([
		logEvent(1),
		logEvent(2),
		logEvent(3),
		logEvent(4),
		logEvent(5),
		logEvent(6),
		logEvent(7),
		logEvent(8, {
			code: "QWEN_ALIGNMENT_WINDOW_FAILED",
			level: "warning",
			at: "2026-09-27T21:01:08Z",
			data: { track: 3, marker: "urgent-warning" },
		}),
		logEvent(9, { data: { track: 3, marker: "post-warning-tail" } }),
	]);
	await expect
		.poll(() => eventReads(state), { timeout: 2_500 })
		.toBeGreaterThan(warningReads);

	// Urgent events bypass cosmetic pacing. The timestamp remains the factual one.
	const warning = log.locator('[data-event-seq="8"]');
	await expect(warning).toBeVisible({ timeout: 350 });
	await expect(warning.locator("time")).toHaveAttribute(
		"datetime",
		"2026-09-27T21:01:08Z",
	);

	await page.getByRole("button", { name: "Pausar visualização" }).click();
	const pausedReads = eventReads(state);
	state.setJobEvents([
		logEvent(1),
		logEvent(2),
		logEvent(3),
		logEvent(4),
		logEvent(5),
		logEvent(6),
		logEvent(7),
		logEvent(8, {
			code: "QWEN_ALIGNMENT_WINDOW_FAILED",
			level: "warning",
			at: "2026-09-27T21:01:08Z",
			data: { track: 3, marker: "urgent-warning" },
		}),
		logEvent(9, { data: { track: 3, marker: "post-warning-tail" } }),
		logEvent(10, { data: { track: 3, marker: "paused-new-event" } }),
	]);
	await expect
		.poll(() => eventReads(state), { timeout: 2_500 })
		.toBeGreaterThan(pausedReads);
	await expect(log.locator('[data-event-seq="10"]')).toHaveCount(0);

	const catchUp = page.getByRole("button", {
		name: "1 novos eventos · Voltar ao vivo",
	});
	await expect(catchUp).toBeVisible();
	await catchUp.click();
	await expect(log.locator('[data-event-seq="10"]')).toBeVisible({
		timeout: 250,
	});
	await page.screenshot({
		path: testInfo.outputPath("live-log-catch-up.png"),
		fullPage: true,
	});
});

test("Live Log reduced motion reveals the complete factual batch immediately", async ({
	page,
}) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	const { state, log } = await openLiveLog(page);
	await expect
		.poll(() =>
			page.evaluate(
				() => matchMedia("(prefers-reduced-motion: reduce)").matches,
			),
		)
		.toBe(true);

	const initialReads = eventReads(state);
	state.setJobEvents([
		logEvent(1),
		logEvent(2),
		logEvent(3),
		logEvent(4),
		logEvent(5),
	]);
	await expect
		.poll(() => eventReads(state), { timeout: 2_500 })
		.toBeGreaterThan(initialReads);
	await expect(log.locator('[data-event-seq="5"]')).toBeVisible({
		timeout: 350,
	});
});
