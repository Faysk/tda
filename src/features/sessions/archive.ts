import type { PublishedSession } from "./model";

export type SessionArchiveMetrics = Readonly<{
	durationMs: number | null;
	wordCount: number | null;
	participantCount: number | null;
}>;

export type SessionArchiveItem = PublishedSession & SessionArchiveMetrics;

export type SessionArchiveSummary = Readonly<{
	sessions: number;
	durationMs: number | null;
	durationCoverage: number;
	wordCount: number | null;
	wordCoverage: number;
	participantCount: number | null;
	participantCoverage: number;
}>;

export function parseArchiveMetric(value: unknown): number | null {
	if (
		typeof value === "number" &&
		Number.isSafeInteger(value) &&
		value >= 0
	) {
		return value;
	}
	if (typeof value === "string" && /^\d+$/.test(value)) {
		const parsed = Number(value);
		return Number.isSafeInteger(parsed) ? parsed : null;
	}
	return null;
}

export function formatArchiveDuration(value: number | null) {
	if (value === null) return "—";
	if (value === 0) return "0 min";
	if (value < 60_000) return "< 1 min";
	const minutes = Math.floor(value / 60_000);
	const hours = Math.floor(minutes / 60);
	const remaining = minutes % 60;
	if (!hours) return `${minutes} min`;
	return `${hours} h${remaining ? ` ${remaining} min` : ""}`;
}

const numberFormatter = new Intl.NumberFormat("pt-BR");

export function formatArchiveNumber(value: number | null) {
	return value === null ? "—" : numberFormatter.format(value);
}

export function summarizeSessionArchive(
	sessions: readonly SessionArchiveItem[],
): SessionArchiveSummary {
	const withDuration = sessions.filter((session) => session.durationMs !== null);
	const withWords = sessions.filter((session) => session.wordCount !== null);
	const withParticipants = sessions.filter(
		(session) => session.participantCount !== null,
	);

	return {
		sessions: sessions.length,
		durationMs: withDuration.length
			? withDuration.reduce(
					(total, session) => total + (session.durationMs ?? 0),
					0,
				)
			: null,
		durationCoverage: withDuration.length,
		wordCount: withWords.length
			? withWords.reduce(
					(total, session) => total + (session.wordCount ?? 0),
					0,
				)
			: null,
		wordCoverage: withWords.length,
		participantCount: withParticipants.length
			? withParticipants.reduce(
					(total, session) => total + (session.participantCount ?? 0),
					0,
				)
			: null,
		participantCoverage: withParticipants.length,
	};
}
