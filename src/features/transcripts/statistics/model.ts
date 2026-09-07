import { countTranscriptWords } from "../../edit/transcript/model";

export type SessionMetric = Readonly<{
	id: string;
	title: string;
	date: string | null;
	words: number | null;
	durationMs: number | null;
}>;

export function recordedDuration(value: unknown): number | null {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
		? value
		: null;
}

export function formatDuration(value: number | null): string {
	if (value === null) return "Não informada";
	if (value === 0) return "0 min";
	if (value < 60_000) return "Menos de 1 min";
	const minutes = Math.floor(value / 60_000);
	const hours = Math.floor(minutes / 60);
	return hours ? `${hours} h${minutes % 60 ? ` ${minutes % 60} min` : ""}` : `${minutes} min`;
}

export const formatWords = (value: number | null) =>
	value === null ? "Não informadas" : new Intl.NumberFormat("pt-BR").format(value);

export function summarize(sessions: readonly SessionMetric[]) {
	const withWords = sessions.filter((session) => session.words !== null);
	const withDuration = sessions.filter((session) => session.durationMs !== null);
	return {
		sessions: sessions.length,
		words: withWords.length ? withWords.reduce((sum, session) => sum + (session.words ?? 0), 0) : null,
		durationMs: withDuration.length ? withDuration.reduce((sum, session) => sum + (session.durationMs ?? 0), 0) : null,
		wordCoverage: withWords.length,
		durationCoverage: withDuration.length,
	};
}

// Same token rule as the canonical Edit writer; never count speaker labels or summaries.
export function segmentWords(text: unknown): number | null {
	return typeof text === "string" ? countTranscriptWords(text) : null;
}
