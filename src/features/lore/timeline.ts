import type {
	LoreNarrationBeatDTO,
	LoreNarrationDTO,
	LorePresentation,
} from "./model";

/** Native captions share the same editorial text and timing as the visible player. */
export function loreNarrationWebVtt(narration: LoreNarrationDTO): string {
	const timestamp = (ms: number) => {
		const value = Math.max(0, Math.round(ms));
		const hours = Math.floor(value / 3600000);
		const minutes = Math.floor(value / 60000) % 60;
		const seconds = Math.floor(value / 1000) % 60;
		return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(value % 1000).padStart(3, "0")}`;
	};
	return `WEBVTT\n\n${narration.beats.map((beat) => {
		const text = beat.subtitle.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replace(/\r?\n\s*\r?\n/g, "\n");
		return `${timestamp(beat.startMs)} --> ${timestamp(beat.endMs)}\n${text}\n\n`;
	}).join("")}`;
}

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
