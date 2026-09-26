export const ANIMATED_NUMBER_MIN_MS = 350;
export const ANIMATED_NUMBER_MAX_MS = 700;

export function clampNumber(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) return min;
	return Math.min(max, Math.max(min, value));
}

export function easeOutCubic(progress: number): number {
	const t = clampNumber(progress, 0, 1);
	return 1 - (1 - t) ** 3;
}

export function interpolateNumber(
	from: number,
	to: number,
	progress: number,
): number {
	return from + (to - from) * easeOutCubic(progress);
}

export function animatedNumberDuration(
	from: number,
	to: number,
	min: number,
	max: number,
): number {
	const range = Math.max(1, Math.abs(max - min));
	const normalizedDelta = clampNumber(Math.abs(to - from) / range, 0, 1);
	return Math.round(
		ANIMATED_NUMBER_MIN_MS +
			normalizedDelta * (ANIMATED_NUMBER_MAX_MS - ANIMATED_NUMBER_MIN_MS),
	);
}

export function shouldAnimateNumber(
	from: number,
	to: number,
	reducedMotion: boolean,
	documentHidden: boolean,
): boolean {
	return (
		!reducedMotion &&
		!documentHidden &&
		Number.isFinite(from) &&
		Number.isFinite(to) &&
		Math.abs(to - from) > 0.0001
	);
}
