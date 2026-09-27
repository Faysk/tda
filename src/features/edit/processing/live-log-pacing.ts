import type { JobEvent } from "./protocol";

const GROUPABLE_CODES = new Set([
	"QWEN_WINDOW_TRANSCRIBED",
	"WHISPER_SEGMENT_TRANSCRIBED",
]);
const URGENT_CODE =
	/(?:FAILED|ERROR|WARNING|INTERRUPT|RETRY|RECOVER|INTEGRITY|UNAVAILABLE|CANCEL)/;
const MAX_REVEAL_STEPS = 10;
const MIN_OBSERVED_GAP_MS = 250;

export type LiveLogRevealPlan = Readonly<{
	immediateThroughSeq: number | null;
	checkpoints: readonly number[];
	budgetMs: number;
	stepMs: number;
	typeDurationMs: number;
}>;

export function isUrgentLogEvent(event: JobEvent): boolean {
	return (
		event.level === "warning" ||
		event.level === "error" ||
		URGENT_CODE.test(event.code)
	);
}

function routineCheckpoints(events: readonly JobEvent[]): number[] {
	const checkpoints: number[] = [];

	for (let index = 0; index < events.length; index += 1) {
		const event = events[index];
		if (!event) continue;
		const previous = events[index - 1];
		const canJoinPrevious =
			previous &&
			event.level === "info" &&
			previous.level === "info" &&
			event.code === previous.code &&
			GROUPABLE_CODES.has(event.code);

		if (canJoinPrevious && checkpoints.length) {
			checkpoints[checkpoints.length - 1] = event.seq;
		} else {
			checkpoints.push(event.seq);
		}
	}

	if (checkpoints.length <= MAX_REVEAL_STEPS) return checkpoints;

	const condensed: number[] = [];
	for (let step = 1; step <= MAX_REVEAL_STEPS; step += 1) {
		const index = Math.ceil((step * checkpoints.length) / MAX_REVEAL_STEPS) - 1;
		const seq = checkpoints[index];
		if (typeof seq === "number" && condensed.at(-1) !== seq) condensed.push(seq);
	}
	return condensed;
}

function revealBudgetMs(
	expectedPollMs: number,
	observedPollGapMs: number | null,
): number {
	const expected = Math.max(MIN_OBSERVED_GAP_MS, expectedPollMs);
	const observed =
		observedPollGapMs !== null &&
		Number.isFinite(observedPollGapMs) &&
		observedPollGapMs >= MIN_OBSERVED_GAP_MS &&
		observedPollGapMs <= expected * 1.5
			? observedPollGapMs
			: expected;
	return Math.max(120, Math.round(Math.min(expected, observed) * 0.9));
}

export function buildLiveLogRevealPlan(
	events: readonly JobEvent[],
	expectedPollMs: number,
	observedPollGapMs: number | null = null,
): LiveLogRevealPlan {
	if (!events.length) {
		return {
			immediateThroughSeq: null,
			checkpoints: [],
			budgetMs: 0,
			stepMs: 0,
			typeDurationMs: 0,
		};
	}

	let lastUrgentIndex = -1;
	for (let index = 0; index < events.length; index += 1) {
		const event = events[index];
		if (event && isUrgentLogEvent(event)) lastUrgentIndex = index;
	}

	const immediateThroughSeq =
		lastUrgentIndex >= 0 ? (events[lastUrgentIndex]?.seq ?? null) : null;
	const routineTail = events.slice(lastUrgentIndex + 1);
	const checkpoints = routineCheckpoints(routineTail);
	const budgetMs = revealBudgetMs(expectedPollMs, observedPollGapMs);
	const stepMs = checkpoints.length
		? Math.max(40, Math.floor(budgetMs / checkpoints.length))
		: 0;
	const typeDurationMs = checkpoints.length
		? Math.min(1200, Math.max(120, Math.round(stepMs * 0.7)))
		: 0;

	return {
		immediateThroughSeq,
		checkpoints,
		budgetMs,
		stepMs,
		typeDurationMs,
	};
}

export function scheduleLiveLogReveal(
	plan: LiveLogRevealPlan,
	revealThrough: (seq: number) => void,
): () => void {
	const timers: ReturnType<typeof setTimeout>[] = [];

	plan.checkpoints.forEach((seq, index) => {
		if (index === 0) {
			revealThrough(seq);
			return;
		}
		timers.push(
			setTimeout(() => revealThrough(seq), plan.stepMs * index),
		);
	});

	return () => {
		for (const timer of timers) clearTimeout(timer);
	};
}
