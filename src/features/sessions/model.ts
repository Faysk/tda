export const CAMPAIGN_SLUG = "yuhara-main";
export type PublishedSession = Readonly<{
	id: string;
	title: string;
	date: string;
	arc: string;
	summary: string;
	fullSummary?: string;
}>;
type Row = {
	source_session_id: unknown;
	title: unknown;
	session_date: unknown;
	arc: unknown;
	summary_short: unknown;
	summary_full?: unknown;
	status: unknown;
	campaigns: unknown;
};
function text(value: unknown, limit: number) {
	return typeof value === "string" ? value.trim().slice(0, limit) : "";
}
export function toPublishedSession(
	row: Row,
	detail = false,
): PublishedSession | null {
	const campaign = row.campaigns as { slug?: unknown } | null;
	if (row.status !== "published" || campaign?.slug !== CAMPAIGN_SLUG)
		return null;
	const id = text(row.source_session_id, 220);
	if (!id) return null;
	return {
		id,
		title: text(row.title, 500) || "Sessão sem título",
		date: text(row.session_date, 10),
		arc: text(row.arc, 300),
		summary: text(row.summary_short, 4000),
		...(detail ? { fullSummary: text(row.summary_full, 200000) } : {}),
	};
}
