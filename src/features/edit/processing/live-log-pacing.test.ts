import { afterEach, describe, expect, it, vi } from "vitest";
import type { JobEvent } from "./protocol";
import {
	planLiveLogReveal,
	scheduleLiveLogReveal,
} from "./live-log-pacing";

function event(
	seq: number,
	overrides: Partial<JobEvent> = {},
): JobEvent {
	return {
		seq,
		attempt: 1,
		code: `ROUTINE_${seq}`,
		at: `2026-09-27T20:00:${String(seq % 60).padStart(2, "0")}Z`,
		level: "info",
		data: {},
		...overrides,
	};
}

afterEach(() => {
	vi.useRealTimers();
});

describe("live log pacing", () => {
	for (const count of [1, 3, 10, 100]) {
		it(`reveals a ${count}-event routine poll inside one visual budget`, () => {
			vi.useFakeTimers();
			const events = Array.from({ length: count }, (_, index) => event(index + 1));
			const plan = planLiveLogReveal(events, 0, 1_500);
			const revealed: number[] = [];
			const cancel = scheduleLiveLogReveal(plan, (seq) => revealed.push(seq));

			vi.advanceTimersByTime(0);
			expect(revealed.length).toBeGreaterThan(0);
			vi.advanceTimersByTime(1_500);
			expect(revealed.at(-1)).toBe(count);
			expect(revealed.length).toBeLessThanOrEqual(10);
			cancel();
		});
	}

	it("aggregates a large success burst before pacing", () => {
		vi.useFakeTimers();
		const events = Array.from({ length: 100 }, (_, index) =>
			event(index + 1, { code: "QWEN_WINDOW_TRANSCRIBED" }),
		);
		const plan = planLiveLogReveal(events, 0, 1_500);
		const revealed: number[] = [];
		scheduleLiveLogReveal(plan, (seq) => revealed.push(seq));

		vi.advanceTimersByTime(0);
		expect(revealed).toEqual([100]);
		expect(plan.steps).toHaveLength(1);
	});

	it("flushes the factual tail immediately when a warning interrupts routine work", () => {
		vi.useFakeTimers();
		const events = [
			event(1),
			event(2),
			event(3, {
				code: "QWEN_ALIGNMENT_WINDOW_FAILED",
				level: "warning",
			}),
			event(4),
		];
		const plan = planLiveLogReveal(events, 0, 1_500);
		const revealed: number[] = [];
		scheduleLiveLogReveal(plan, (seq) => revealed.push(seq));

		expect(plan.flushAll).toBe(true);
		vi.advanceTimersByTime(0);
		expect(revealed).toEqual([4]);
	});

	it("replans only the unrevealed tail when a poll arrives early", () => {
		vi.useFakeTimers();
		const first = planLiveLogReveal([event(1), event(2), event(3)], 0, 1_500);
		const revealed: number[] = [];
		const cancelFirst = scheduleLiveLogReveal(first, (seq) => revealed.push(seq));
		vi.advanceTimersByTime(0);
		expect(revealed).toEqual([1]);

		cancelFirst();
		const second = planLiveLogReveal(
			[event(1), event(2), event(3), event(4), event(5)],
			1,
			1_500,
		);
		scheduleLiveLogReveal(second, (seq) => revealed.push(seq));
		vi.advanceTimersByTime(1_500);

		expect(revealed[0]).toBe(1);
		expect(revealed.at(-1)).toBe(5);
	});
});
