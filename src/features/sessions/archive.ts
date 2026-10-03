import type { PublishedSession } from "./model";

export type SessionArchiveItem = PublishedSession;

export type SessionArchiveSummary = Readonly<{
	sessions: number;
	arcs: number;
	firstDate: string;
	latestDate: string;
}>;

export type SessionArcIdentityOptions = Readonly<{
	qualifyByCampaign?: boolean;
}>;

export type SessionArcOption = Readonly<{
	identity: string;
	label: string;
	normalizedArc: string;
	campaignSlug: string;
	campaignName: string;
}>;

const numberFormatter = new Intl.NumberFormat("pt-BR");
const monthFormatter = new Intl.DateTimeFormat("pt-BR", {
	month: "short",
	timeZone: "UTC",
});
const arcCollator = new Intl.Collator("pt-BR", {
	sensitivity: "base",
	numeric: true,
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

export function normalizeSessionArcIdentity(value: string) {
	return value.trim().normalize("NFC").toLocaleLowerCase("pt-BR");
}

export function sessionArcIdentity(
	session: Pick<SessionArchiveItem, "arc" | "campaignSlug">,
	options: SessionArcIdentityOptions = {},
) {
	const normalizedArc = normalizeSessionArcIdentity(session.arc);
	if (!normalizedArc) return "";
	return options.qualifyByCampaign
		? JSON.stringify([session.campaignSlug, normalizedArc])
		: normalizedArc;
}

export function listSessionArcOptions(
	sessions: readonly SessionArchiveItem[],
	options: SessionArcIdentityOptions = {},
): readonly SessionArcOption[] {
	const byIdentity = new Map<string, SessionArcOption>();

	for (const session of sessions) {
		const label = session.arc.trim();
		const normalizedArc = normalizeSessionArcIdentity(label);
		if (!normalizedArc) continue;

		const identity = sessionArcIdentity(session, options);
		if (byIdentity.has(identity)) continue;

		byIdentity.set(identity, {
			identity,
			label,
			normalizedArc,
			campaignSlug: session.campaignSlug,
			campaignName: session.campaignName,
		});
	}

	return Array.from(byIdentity.values()).sort(
		(a, b) =>
			arcCollator.compare(a.label, b.label) ||
			arcCollator.compare(a.campaignName, b.campaignName),
	);
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
	options: { qualifyArcsByCampaign?: boolean } = {},
): SessionArchiveSummary {
	const arcs = new Set<string>();
	const dates: string[] = [];

	for (const session of sessions) {
		const arcIdentity = sessionArcIdentity(session, {
			qualifyByCampaign: options.qualifyArcsByCampaign,
		});
		if (arcIdentity) arcs.add(arcIdentity);
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
