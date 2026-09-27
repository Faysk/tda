import type { JobEvent } from "./protocol";

const GROUPABLE_ROUTINE_CODES = new Set([
	"QWEN_WINDOW_TRANSCRIBED",
	"WHISPER_SEGMENT_TRANSCRIBED",
]);

const URGENT_CODE = /(FAIL|ERROR|INTERRUPT|RETRY|RECOVER|INTEGRITY|UNAVAILABLE|CANCEL|CORRUPT|MISMATCH)/u;
const MAX_ROUTINE_REVEAL_SLOTS = 12;

export type LiveLogRevealStep = Readonly<{
	delayMs: number;
	events: readonly JobEvent[];
	typeDurationMs: number;
}>;

export function isUrgentLiveLogEvent(event: JobEvent): boolean {
	if (event.level === "warning" || event.level === "error") return true;
	return URGENT_CODE.test(event.code);
}

function routineGroups(
	events: readonly JobEvent[],
	aggregateRoutine: boolean,
): JobEvent[][] {
	const groups: JobEvent[][] = [];
	for (const event of events) {
		const previous = groups.at(-1);
		const previousEvent = previous?.at(-1);
		if (
			aggregateRoutine &&
			previous &&
			previousEvent &&
			GROUPABLE_ROUTINE_CODES.has(event.code) &&
			event.level === "info" &&
			previousEvent.code === event.code &&
			previousEvent.level === "info"
		) {
			previous.push(event);
			continue;
		}
		groups.push([event]);
	}
	return groups;
}

function compactRoutineGroups(groups: readonly JobEvent[][]): JobEvent[][] {
	if (groups.length <= MAX_ROUTINE_REVEAL_SLOTS) {
		return groups.map((group) => [...group]);
	}
	const perSlot = Math.ceil(groups.length / MAX_ROUTINE_REVEAL_SLOTS);
	const compacted: JobEvent[][] = [];
	for (let index = 0; index < groups.length; index += perSlot) {
		compacted.push(groups.slice(index, index + perSlot).flat());
	}
	return compacted;
}

function visualWindowMs(expectedPollMs: number, observedPollGapMs?: number): number {
	const expected = Math.max(0, expectedPollMs);
	if (
		observedPollGapMs === undefined ||
		!Number.isFinite(observedPollGapMs) ||
		observedPollGapMs <= 0
	) {
		return expected;
	}
	// An early poll shortens the remaining presentation budget. A late poll does
	// not create extra theatrical delay: the expected cadence remains the cap.
	return Math.min(expected, observedPollGapMs);
}

export function buildLiveLogRevealPlan(
	events: readonly JobEvent[],
	expectedPollMs: number,
	observedPollGapMs?: number,
	aggregateRoutine = true,
): readonly LiveLogRevealStep[] {
	if (!events.length) return [];

	let lastUrgentIndex = -1;
	for (let index = 0; index < events.length; index += 1) {
		if (isUrgentLiveLogEvent(events[index]!)) lastUrgentIndex = index;
	}

	const steps: LiveLogRevealStep[] = [];
	let routineStart = 0;
	if (lastUrgentIndex >= 0) {
		steps.push({
			delayMs: 0,
			events: events.slice(0, lastUrgentIndex + 1),
			typeDurationMs: 0,
		});
		routineStart = lastUrgentIndex + 1;
	}

	const routine = compactRoutineGroups(
		routineGroups(events.slice(routineStart), aggregateRoutine),
	);
	if (!routine.length) return steps;

	const visualBudgetMs = visualWindowMs(expectedPollMs, observedPollGapMs) * 0.9;
	const slotMs = visualBudgetMs / routine.length;
	const typeDurationMs = Math.round(
		Math.min(1200, Math.max(120, slotMs * 0.7)),
	);
	const startsAfterUrgent = lastUrgentIndex >= 0;

	routine.forEach((group, index) => {
		steps.push({
			delayMs: Math.round((index + (startsAfterUrgent ? 1 : 0)) * slotMs),
			events: group,
			typeDurationMs,
		});
	});
	return steps;
}

export function scheduleLiveLogRevealPlan(
	plan: readonly LiveLogRevealStep[],
	onReveal: (step: LiveLogRevealStep) => void,
): () => void {
	const timers: ReturnType<typeof setTimeout>[] = [];
	for (const step of plan) {
		if (step.delayMs <= 0) {
			onReveal(step);
			continue;
		}
		timers.push(setTimeout(() => onReveal(step), step.delayMs));
	}
	return () => {
		for (const timer of timers) clearTimeout(timer);
	};
}
