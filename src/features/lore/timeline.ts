import type {
	LoreNarrationBeatDTO,
	LoreNarrationDTO,
	LorePresentation,
} from "./model";

export function findActiveLoreBeat(
	beats: readonly LoreNarrationBeatDTO[],
	currentMs: number,
): LoreNarrationBeatDTO | null {
	return (
		beats.find(
			(beat) => currentMs >= beat.startMs && currentMs < beat.endMs,
		) ?? null
	);
}

export function loreNarrationEndMs(narration: LoreNarrationDTO): number {
	return Math.max(
		narration.durationMs ?? 0,
		...narration.beats.map((beat) => beat.endMs),
	);
}

export function validateLoreNarration(
	narration: LoreNarrationDTO,
	presentation?: LorePresentation,
): string[] {
	const errors: string[] = [];
	const seen = new Set<string>();
	let previousEnd = -1;
	const sceneIds = new Set(presentation?.scenes.map((scene) => scene.id) ?? []);

	for (const beat of narration.beats) {
		if (seen.has(beat.id)) errors.push(`duplicate beat id: ${beat.id}`);
		seen.add(beat.id);
		if (beat.startMs < 0) errors.push(`negative beat start: ${beat.id}`);
		if (beat.endMs <= beat.startMs) errors.push(`invalid beat range: ${beat.id}`);
		if (beat.startMs < previousEnd) errors.push(`overlapping beat: ${beat.id}`);
		if (beat.sceneId && presentation && !sceneIds.has(beat.sceneId)) {
			errors.push(`unknown scene: ${beat.sceneId}`);
		}
		previousEnd = Math.max(previousEnd, beat.endMs);
	}

	return errors;
}
