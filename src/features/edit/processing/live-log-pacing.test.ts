import { afterEach, describe, expect, it, vi } from "vitest";
import type { JobEvent } from "./protocol";
import {
	buildLiveLogRevealPlan,
	scheduleLiveLogReveal,
} from "./live-log-pacing";

function event(
	seq: number,
	code = "TRACK_STARTED",
	level: JobEvent["level"] = "info",
): JobEvent {
	return {
		seq,
		code,
		at: `2026-09-27T20:00:${String(seq % 60).padStart(2, "0")}Z`,
		level,
		attempt: 1,
		data: { track: seq },
	};
}

afterEach(() => {
	vi.useRealTimers();
});

describe("live-log pacing", () => {
	it.each([1, 3, 10, 100])(
		"bounds %i routine events to one poll window",
		(count) => {
			const events = Array.from({ length: count }, (_, index) => event(index + 1));
			const plan = buildLiveLogRevealPlan(events, 1500);

			expect(plan.checkpoints.length).toBeLessThanOrEqual(10);
			expect(plan.checkpoints.at(-1)).toBe(count);
			expect(plan.budgetMs).toBe(1350);
			expect(plan.stepMs).toBeGreaterThanOrEqual(40);
		},
	);

	it("aggregates repetitive success spam before pacing", () => {
		const events = Array.from({ length: 100 }, (_, index) =>
			event(index + 1, "QWEN_WINDOW_TRANSCRIBED"),
		);
		const plan = buildLiveLogRevealPlan(events, 1500);

		expect(plan.checkpoints).toEqual([100]);
	});

	it("flushes routine backlog through an urgent warning, then paces the tail", () => {
		const events = [
			event(1),
			event(2),
			event(3, "QWEN_ALIGNMENT_WINDOW_FAILED", "warning"),
			event(4),
			event(5),
		];
		const plan = buildLiveLogRevealPlan(events, 1500);

		expect(plan.immediateThroughSeq).toBe(3);
		expect(plan.checkpoints).toEqual([4, 5]);
	});

	it("uses a shorter observed poll gap without extending beyond the expected cadence", () => {
		expect(buildLiveLogRevealPlan([event(1)], 1500, 900).budgetMs).toBe(810);
		expect(buildLiveLogRevealPlan([event(1)], 1500, 4000).budgetMs).toBe(1350);
	});

	it("schedules checkpoints without replaying an already revealed step", () => {
		vi.useFakeTimers();
		const plan = buildLiveLogRevealPlan(
			[event(1), event(2), event(3)],
			1500,
		);
		const revealed: number[] = [];

		const cancel = scheduleLiveLogReveal(plan, (seq) => revealed.push(seq));
		expect(revealed).toEqual([1]);

		vi.advanceTimersByTime(plan.stepMs);
		expect(revealed).toEqual([1, 2]);

		vi.runAllTimers();
		expect(revealed).toEqual([1, 2, 3]);
		cancel();
	});
});
