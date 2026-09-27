import { afterEach, describe, expect, it, vi } from "vitest";
import type { JobEvent } from "./protocol";
import {
	buildLiveLogRevealPlan,
	scheduleLiveLogRevealPlan,
} from "./live-log-pacing";

function event(
	seq: number,
	overrides: Partial<JobEvent> = {},
): JobEvent {
	return {
		seq,
		at: `2026-09-27T20:00:${String(seq % 60).padStart(2, "0")}Z`,
		code: `ROUTINE_${seq}`,
		level: "info",
		attempt: 1,
		data: {},
		...overrides,
	};
}

afterEach(() => {
	vi.useRealTimers();
});

describe("live-log pacing", () => {
	for (const count of [1, 3, 10, 100]) {
		it(`reveals ${count} routine events inside one 1500ms poll budget without loss`, () => {
			vi.useFakeTimers();
			const input = Array.from({ length: count }, (_, index) => event(index + 1));
			const plan = buildLiveLogRevealPlan(input, 1500);
			const revealed: number[] = [];
			scheduleLiveLogRevealPlan(plan, (step) => {
				revealed.push(...step.events.map((item) => item.seq));
			});

			expect(revealed.length).toBeGreaterThan(0);
			expect(plan.length).toBeLessThanOrEqual(12);
			vi.advanceTimersByTime(1500);
			expect(revealed).toEqual(input.map((item) => item.seq));
			expect(Math.max(...plan.map((step) => step.delayMs))).toBeLessThanOrEqual(1350);
		});
	}

	it("shortens the visual window when the next poll arrives early", () => {
		const input = [event(1), event(2), event(3), event(4)];
		const plan = buildLiveLogRevealPlan(input, 1500, 500);
		expect(Math.max(...plan.map((step) => step.delayMs))).toBeLessThanOrEqual(450);
	});

	it("flushes routine context through a warning immediately and paces only the later tail", () => {
		vi.useFakeTimers();
		const input = [
			event(1),
			event(2),
			event(3, { code: "QWEN_ALIGNMENT_WINDOW_FAILED", level: "warning" }),
			event(4),
			event(5),
		];
		const plan = buildLiveLogRevealPlan(input, 1500);
		const revealed: number[] = [];
		scheduleLiveLogRevealPlan(plan, (step) => {
			revealed.push(...step.events.map((item) => item.seq));
		});

		expect(revealed).toEqual([1, 2, 3]);
		vi.advanceTimersByTime(1500);
		expect(revealed).toEqual([1, 2, 3, 4, 5]);
	});

	it("aggregates consecutive high-volume transcription success spam before pacing", () => {
		const input = Array.from({ length: 100 }, (_, index) =>
			event(index + 1, {
				code: "QWEN_WINDOW_TRANSCRIBED",
				data: { track: 1, window: index + 1 },
			}),
		);
		const plan = buildLiveLogRevealPlan(input, 1500);
		expect(plan).toHaveLength(1);
		expect(plan[0]?.events).toHaveLength(100);
		expect(plan[0]?.delayMs).toBe(0);
	});
});
