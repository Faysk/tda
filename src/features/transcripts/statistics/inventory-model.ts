import type { SessionMetric } from "./model";

export type CoverageFilter = "all" | "complete" | "incomplete";
export type SortOption =
	| "date-desc"
	| "date-asc"
	| "title-asc"
	| "title-desc"
	| "words-desc"
	| "words-asc"
	| "duration-desc"
	| "duration-asc";

const titleCollator = new Intl.Collator("pt-BR", {
	numeric: true,
	sensitivity: "base",
});

function normalizeSearch(value: string) {
	return value
		.normalize("NFKD")
		.replace(/\p{M}/gu, "")
		.toLocaleLowerCase("pt-BR");
}

export function sessionHasCompleteCoverage(session: SessionMetric) {
	return session.words !== null && session.durationMs !== null;
}

function compareNullable<T>(
	left: T | null,
	right: T | null,
	compare: (a: T, b: T) => number,
	direction: 1 | -1,
) {
	if (left === null && right === null) return 0;
	if (left === null) return 1;
	if (right === null) return -1;
	return compare(left, right) * direction;
}

function compareSessions(
	left: SessionMetric,
	right: SessionMetric,
	sort: SortOption,
) {
	switch (sort) {
		case "date-asc":
			return compareNullable(
				left.date,
				right.date,
				(a, b) => a.localeCompare(b),
				1,
			);
		case "date-desc":
			return compareNullable(
				left.date,
				right.date,
				(a, b) => a.localeCompare(b),
				-1,
			);
		case "title-desc":
			return titleCollator.compare(left.title, right.title) * -1;
		case "title-asc":
			return titleCollator.compare(left.title, right.title);
		case "words-asc":
			return compareNullable(left.words, right.words, (a, b) => a - b, 1);
		case "words-desc":
			return compareNullable(left.words, right.words, (a, b) => a - b, -1);
		case "duration-asc":
			return compareNullable(
				left.durationMs,
				right.durationMs,
				(a, b) => a - b,
				1,
			);
		case "duration-desc":
			return compareNullable(
				left.durationMs,
				right.durationMs,
				(a, b) => a - b,
				-1,
			);
	}
}

export function filterAndSortSessions(
	sessions: readonly SessionMetric[],
	query: string,
	coverage: CoverageFilter,
	sort: SortOption,
) {
	const normalizedQuery = normalizeSearch(query.trim());
	return sessions
		.map((session, index) => ({ session, index }))
		.filter(({ session }) => {
			if (
				normalizedQuery &&
				!normalizeSearch(session.title).includes(normalizedQuery)
			) {
				return false;
			}
			if (coverage === "complete") return sessionHasCompleteCoverage(session);
			if (coverage === "incomplete") {
				return !sessionHasCompleteCoverage(session);
			}
			return true;
		})
		.sort(
			(left, right) =>
				compareSessions(left.session, right.session, sort) ||
				left.index - right.index,
		)
		.map(({ session }) => session);
}
