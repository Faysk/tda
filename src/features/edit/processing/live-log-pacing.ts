import type { JobEvent } from "./protocol";

export const GROUPABLE_LIVE_LOG_CODES = new Set([
	"QWEN_WINDOW_TRANSCRIBED",
	"WHISPER_SEGMENT_TRANSCRIBED",
]);

const MAX_PACED_STEPS = 10;
const VISUAL_BUDGET_RATIO = 0.9;
const MIN_VISUAL_BUDGET_MS = 120;
const MAX_VISUAL_BUDGET_MS = 6_000;
const MIN_TYPE_DURATION_MS = 120;
const MAX_TYPE_DURATION_MS = 1_200;

export type LiveLogRevealStep = Readonly<{
	delayMs: number;
	throughSeq: number;
}>;

export type LiveLogRevealPlan = Readonly<{
	steps: readonly LiveLogRevealStep[];
	typeDurationMs: number;
	flushAll: boolean;
}>;

export function liveLogEventIsUrgent(event: JobEvent): boolean {
	if (event.level === "warning" || event.level === "error") return true;
	return /(?:FAILED|ERROR|WARNING|INTERRUPTED|CANCEL|UNAVAILABLE|INTEGRITY|RETRY|RECOVERY|ACTION_REQUIRED)/u.test(
		event.code,
	);
}

function routineRowBoundaries(events: readonly JobEvent[]): number[] {
	const boundaries: number[] = [];
	let previous: JobEvent | null = null;
	for (const event of events) {
		const joinsPrevious =
			previous !== null &&
			GROUPABLE_LIVE_LOG_CODES.has(event.code) &&
			GROUPABLE_LIVE_LOG_CODES.has(previous.code) &&
			event.code === previous.code &&
			event.level === "info" &&
			previous.level === "info";
		if (joinsPrevious) {
			boundaries[boundaries.length - 1] = event.seq;
		} else {
			boundaries.push(event.seq);
		}
		previous = event;
	}
	return boundaries;
}

function boundedStepBoundaries(boundaries: readonly number[]): number[] {
	if (boundaries.length <= MAX_PACED_STEPS) return [...boundaries];
	const selected: number[] = [];
	for (let index = 1; index <= MAX_PACED_STEPS; index += 1) {
		const boundaryIndex =
			Math.ceil((index * boundaries.length) / MAX_PACED_STEPS) - 1;
		const boundary = boundaries[boundaryIndex];
		if (boundary !== undefined && boundary !== selected.at(-1))
			selected.push(boundary);
	}
	return selected;
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, value));
}

function visualPollWindowMs(
	expectedPollMs: number,
	observedPollGapMs?: number,
): number {
	const expected = Math.max(0, expectedPollMs);
	if (
		observedPollGapMs === undefined ||
		!Number.isFinite(observedPollGapMs) ||
		observedPollGapMs <= 0
	) {
		return expected;
	}
	// An early poll shortens the cosmetic budget. A late poll never grants extra
	// theatrical delay beyond the configured cadence.
	return Math.min(expected, observedPollGapMs);
}

export function planLiveLogReveal(
	events: readonly JobEvent[],
	afterSeq: number | null,
	expectedPollMs: number,
	observedPollGapMs?: number,
): LiveLogRevealPlan {
	const tail = events.filter(
		(event) => afterSeq === null || event.seq > afterSeq,
	);
	if (!tail.length) return { steps: [], typeDurationMs: 0, flushAll: false };

	const latest = tail.at(-1);
	if (!latest) return { steps: [], typeDurationMs: 0, flushAll: false };

	if (tail.some(liveLogEventIsUrgent)) {
		return {
			steps: [{ delayMs: 0, throughSeq: latest.seq }],
			typeDurationMs: 0,
			flushAll: true,
		};
	}

	const boundaries = boundedStepBoundaries(routineRowBoundaries(tail));
	const visualBudgetMs = clamp(
		Math.round(
			visualPollWindowMs(expectedPollMs, observedPollGapMs) *
				VISUAL_BUDGET_RATIO,
		),
		MIN_VISUAL_BUDGET_MS,
		MAX_VISUAL_BUDGET_MS,
	);
	const slotMs = visualBudgetMs / Math.max(1, boundaries.length);
	const typeDurationMs = clamp(
		Math.round(slotMs * 0.7),
		MIN_TYPE_DURATION_MS,
		MAX_TYPE_DURATION_MS,
	);

	return {
		steps: boundaries.map((throughSeq, index) => ({
			delayMs: Math.round(index * slotMs),
			throughSeq,
		})),
		typeDurationMs,
		flushAll: false,
	};
}

export function scheduleLiveLogReveal(
	plan: LiveLogRevealPlan,
	onReveal: (throughSeq: number) => void,
): () => void {
	const timers = plan.steps.map((step) =>
		globalThis.setTimeout(() => onReveal(step.throughSeq), step.delayMs),
	);
	return () => {
		for (const timer of timers) globalThis.clearTimeout(timer);
	};
}
