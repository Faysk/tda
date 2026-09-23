import {
	recordedDuration,
	segmentWords,
	summarize,
	type SessionMetric,
} from "./model";
import type { SessionRow } from "./read";

export type LegacySegmentRow = {
	id: string;
	session_id: string;
	source_segment_id: string | null;
	text: string | null;
};

export type LegacyStatisticsSource = {
	sessions: (
		campaign: string,
		after: string | null,
	) => Promise<readonly SessionRow[]>;
	segments: (
		campaign: string,
		session: string,
		after: string | null,
	) => Promise<readonly LegacySegmentRow[]>;
};

async function* allRows<T extends { id: string }>(
	read: (after: string | null) => Promise<readonly T[]>,
) {
	let after: string | null = null;
	while (true) {
		const page = await read(after);
		if (!page.length) return;
		for (const row of page) {
			if (!row.id || (after !== null && row.id <= after))
				throw new Error("Non-progressing statistics cursor");
			after = row.id;
			yield row;
		}
	}
}

// Temporary rollback-safe path. Keep until the V2 read model has been migrated,
// enabled, benchmarked and observed healthy in Production.
export async function collectLegacyStatistics(
	campaign: string,
	source: LegacyStatisticsSource,
) {
	const sessions: SessionMetric[] = [];
	for await (const session of allRows((after) =>
		source.sessions(campaign, after),
	)) {
		let words = 0;
		let count = 0;
		let complete = true;
		const sourceIds = new Set<string>();
		for await (const segment of allRows((after) =>
			source.segments(campaign, session.id, after),
		)) {
			if (segment.session_id !== session.id)
				throw new Error("Statistics session mismatch");
			if (segment.source_segment_id !== null) {
				if (sourceIds.has(segment.source_segment_id))
					throw new Error("Ambiguous transcript source");
				sourceIds.add(segment.source_segment_id);
			}
			const value = segmentWords(segment.text);
			if (value === null) complete = false;
			else words += value;
			count++;
		}
		sessions.push({
			id: session.id,
			title: session.title,
			date: session.session_date,
			durationMs: recordedDuration(session.duration_ms),
			words: count && complete ? words : null,
		});
	}
	return { sessions, totals: summarize(sessions) };
}
