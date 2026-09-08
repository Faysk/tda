import type { PublishedSession } from "./model";

export type SessionArchiveItem = PublishedSession;

export type SessionArchiveSummary = Readonly<{
	sessions: number;
	arcs: number;
	firstDate: string;
	latestDate: string;
}>;

const numberFormatter = new Intl.NumberFormat("pt-BR");
const monthFormatter = new Intl.DateTimeFormat("pt-BR", {
	month: "short",
	timeZone: "UTC",
});

function archiveDateParts(value: string) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
	const [year, month, day] = value.split("-").map(Number);
	if (!year || !month || !day) return null;
	const date = new Date(Date.UTC(year, month - 1, day));
	if (
		date.getUTCFullYear() !== year ||
		date.getUTCMonth() !== month - 1 ||
		date.getUTCDate() !== day
	) {
		return null;
	}
	return { date, day, year };
}

export function formatArchiveNumber(value: number) {
	return numberFormatter.format(value);
}

export function formatArchiveDate(value: string) {
	const parts = archiveDateParts(value);
	if (!parts) return "—";
	const month = monthFormatter.format(parts.date).replace(/\.$/, "");
	return `${String(parts.day).padStart(2, "0")} ${month} ${parts.year}`;
}

export function summarizeSessionArchive(
	sessions: readonly SessionArchiveItem[],
): SessionArchiveSummary {
	const arcs = new Set<string>();
	const dates: string[] = [];

	for (const session of sessions) {
		const arc = session.arc.trim();
		if (arc) arcs.add(arc.toLocaleLowerCase("pt-BR"));
		if (archiveDateParts(session.date)) dates.push(session.date);
	}

	dates.sort();

	return {
		sessions: sessions.length,
		arcs: arcs.size,
		firstDate: dates[0] ?? "",
		latestDate: dates.at(-1) ?? "",
	};
}
