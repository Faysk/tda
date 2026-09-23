import { recordedDuration, summarize, type SessionMetric } from "./model";

export type SessionRow = {
	id: string;
	title: string;
	session_date: string | null;
	duration_ms: number | null;
};

export type SessionAggregateRow = {
	session_id: string;
	segment_count: number;
	complete_text_count: number;
	word_count: number;
};

export type StatisticsSource = {
	sessions: (
		campaign: string,
		after: string | null,
	) => Promise<readonly SessionRow[]>;
	aggregates: (
		campaign: string,
		sessionIds: readonly string[],
	) => Promise<readonly SessionAggregateRow[]>;
};

function nonNegativeInteger(value: unknown, label: string): number {
	if (
		typeof value !== "number" ||
		!Number.isSafeInteger(value) ||
		value < 0
	) {
		throw new Error(`Invalid statistics ${label}`);
	}
	return value;
}

function metricWords(
	aggregate: SessionAggregateRow | undefined,
): number | null {
	if (!aggregate) return null;
	const segmentCount = nonNegativeInteger(
		aggregate.segment_count,
		"segment count",
	);
	const completeTextCount = nonNegativeInteger(
		aggregate.complete_text_count,
		"complete text count",
	);
	const wordCount = nonNegativeInteger(aggregate.word_count, "word count");
	if (segmentCount < 1 || completeTextCount > segmentCount)
		throw new Error("Invalid statistics aggregate");
	return completeTextCount === segmentCount ? wordCount : null;
}

// Internal collector. The server boundary must authorize the campaign before calling it.
// Cost is O(sessions) and independent of transcript segment volume: every session page
// performs at most one aggregate lookup for the session ids already authorized by the
// campaign-filtered sessions query.
export async function collectStatistics(
	campaign: string,
	source: StatisticsSource,
) {
	const sessions: SessionMetric[] = [];
	let after: string | null = null;

	while (true) {
		const page = await source.sessions(campaign, after);
		if (!page.length) break;

		const pageIds: string[] = [];
		for (const session of page) {
			if (!session.id || (after !== null && session.id <= after))
				throw new Error("Non-progressing statistics cursor");
			if (
				pageIds.length &&
				session.id <= pageIds[pageIds.length - 1]
			) {
				throw new Error("Non-progressing statistics cursor");
			}
			pageIds.push(session.id);
		}

		const aggregateRows = await source.aggregates(campaign, pageIds);
		const aggregates = new Map<string, SessionAggregateRow>();
		const allowed = new Set(pageIds);
		for (const aggregate of aggregateRows) {
			if (!allowed.has(aggregate.session_id))
				throw new Error("Statistics aggregate session mismatch");
			if (aggregates.has(aggregate.session_id))
				throw new Error("Duplicate statistics aggregate");
			// Validate eagerly even when the row later maps to an incomplete metric.
			metricWords(aggregate);
			aggregates.set(aggregate.session_id, aggregate);
		}

		for (const session of page) {
			sessions.push({
				id: session.id,
				title: session.title,
				date: session.session_date,
				durationMs: recordedDuration(session.duration_ms),
				words: metricWords(aggregates.get(session.id)),
			});
		}

		after = pageIds[pageIds.length - 1];
	}

	return { sessions, totals: summarize(sessions) };
}
