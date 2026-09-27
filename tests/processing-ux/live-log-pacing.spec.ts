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
	await page.getByRole("button", { name: "Técnica" }).click();
	await expect(page.getByText("TRACK_PROGRESS · seq 1", { exact: true })).toBeVisible();
	return state;
}

test("live log paces routine batches, bypasses urgent events and keeps factual catch-up immediate", async ({
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
		page.getByText("TRACK_PROGRESS · seq 2", { exact: true }),
	).toBeVisible({ timeout: 350 });
	await expect(
		page.getByText("TRACK_PROGRESS · seq 7", { exact: true }),
	).toHaveCount(0);
	await page.screenshot({
		path: testInfo.outputPath("live-log-paced-window.png"),
		fullPage: true,
	});
	await expect(
		page.getByText("TRACK_PROGRESS · seq 7", { exact: true }),
	).toBeVisible({ timeout: 1_500 });

	const urgentReadCount = eventReads(state);
	state.setJobEvents([
		logEvent(1),
		...Array.from({ length: 6 }, (_, index) => logEvent(index + 2)),
		logEvent(8),
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
		page.getByText("WORKER_RESULT_TEARDOWN_FORCED · seq 9", { exact: true }),
	).toBeVisible({ timeout: 350 });
	await expect(
		page.getByText("TRACK_PROGRESS · seq 10", { exact: true }),
	).toHaveCount(0);

	// Search works against the complete factual buffer, not only the visual queue.
	await page.getByPlaceholder("Buscar code, speaker, stage…").fill("tail-10");
	await expect(
		page.getByText("TRACK_PROGRESS · seq 10", { exact: true }),
	).toBeVisible({ timeout: 250 });
	await page.getByPlaceholder("Buscar code, speaker, stage…").fill("");

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
		page.getByText("TRACK_PROGRESS · seq 11", { exact: true }),
	).toHaveCount(0);
	const catchUp = page.getByRole("button", {
		name: /1 novos eventos · Voltar ao vivo/,
	});
	await expect(catchUp).toBeVisible();
	await catchUp.click();
	await expect(
		page.getByText("TRACK_PROGRESS · seq 11", { exact: true }),
	).toBeVisible({ timeout: 250 });
	await page.screenshot({
		path: testInfo.outputPath("live-log-caught-up.png"),
		fullPage: true,
	});
});

test("reduced motion reveals the complete factual batch without cosmetic pacing", async ({
	page,
}) => {
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
		page.getByText("TRACK_PROGRESS · seq 5", { exact: true }),
	).toBeVisible({ timeout: 350 });
});
