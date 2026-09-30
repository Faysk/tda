export const LEGACY_CAMPAIGN_TECHNICAL_SLUG = "yuhara-main";
export const LEGACY_CAMPAIGN_PUBLIC_SLUG = "cronicas-da-mesa";
export const LEGACY_CAMPAIGN_NAME = "Crônicas da Mesa";

// Backward-compatible technical slug for legacy consumers during the multi-campaign rollout.
export const CAMPAIGN_SLUG = LEGACY_CAMPAIGN_TECHNICAL_SLUG;

export type PublishedSession = Readonly<{
	id: string;
	campaignId: string;
	campaignSlug: string;
	campaignName: string;
	campaignTechnicalSlug: string;
	title: string;
	date: string;
	arc: string;
	summary: string;
	coverImage?: string;
	heroImage?: string;
	fullSummary?: string;
}>;

type Row = {
	source_session_id: unknown;
	title: unknown;
	session_date: unknown;
	arc: unknown;
	summary_short: unknown;
	summary_full?: unknown;
	cover_image_url?: unknown;
	hero_image_url?: unknown;
	status: unknown;
	campaigns: unknown;
};

const publicImageSources = [
	{ hostname: "dmrqnbdvbkfqzctcerbx.supabase.co", pathname: "/storage/v1/object/public/session-images/" },
	{ hostname: "dnd.faysk.dev", pathname: "/assets/sessions/" },
] as const;

function text(value: unknown, limit: number) {
	return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function publicImageUrl(value: unknown, campaignTechnicalSlug: string) {
	if (typeof value !== "string" || value.length > 2000) return "";
	try {
		const url = new URL(value);
		if (url.protocol !== "https:") return "";
		if (url.hostname === "media.dnd.faysk.dev") {
			if (url.port || url.search || url.hash || url.username || url.password) return "";
			const campaignPrefix = `/campaigns/${campaignTechnicalSlug}/sessions/`;
			return url.pathname.startsWith(campaignPrefix) ? url.toString() : "";
		}
		return publicImageSources.some(
			(source) => url.hostname === source.hostname && url.pathname.startsWith(source.pathname),
		)
			? url.toString()
			: "";
	} catch {
		return "";
	}
}

export function sessionPublicPath(session: Pick<PublishedSession, "id" | "campaignSlug">) {
	return `/campanhas/${encodeURIComponent(session.campaignSlug)}/sessoes/${encodeURIComponent(session.id)}`;
}

export function sessionPublicKey(session: Pick<PublishedSession, "id" | "campaignSlug">) {
	return `${session.campaignSlug}:${session.id}`;
}

export function formatSessionDate(value: string) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
	const [year, month, day] = value.split("-").map(Number);
	if (!year || !month || !day) return "";
	const date = new Date(Date.UTC(year, month - 1, day));
	if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
	return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

export function toPublishedSession(row: Row, detail = false): PublishedSession | null {
	const campaign = row.campaigns as {
		id?: unknown;
		slug?: unknown;
		public_slug?: unknown;
		name?: unknown;
		lifecycle?: unknown;
		visibility?: unknown;
	} | null;
	if (row.status !== "published" || !campaign) return null;
	const technicalSlug = text(campaign.slug, 220);
	const campaignSlug = text(campaign.public_slug, 220);
	const campaignName = text(campaign.name, 500);
	const campaignId = text(campaign.id, 100);
	if (!technicalSlug || !campaignSlug || !campaignName) return null;
	if (campaign.lifecycle !== "active" || campaign.visibility !== "public") return null;
	const id = text(row.source_session_id, 220);
	if (!id) return null;
	const coverImage = publicImageUrl(row.cover_image_url, technicalSlug);
	const heroImage = publicImageUrl(row.hero_image_url, technicalSlug);
	return {
		id,
		campaignId,
		campaignSlug,
		campaignName,
		campaignTechnicalSlug: technicalSlug,
		title: text(row.title, 500) || "Sessão sem título",
		date: text(row.session_date, 10),
		arc: text(row.arc, 300),
		summary: text(row.summary_short, 4000),
		...(coverImage ? { coverImage } : {}),
		...(heroImage ? { heroImage } : {}),
		...(detail ? { fullSummary: text(row.summary_full, 200000) } : {}),
	};
}

export function toLegacyPublishedSession(row: Row, detail = false): PublishedSession | null {
	const campaign = row.campaigns as { id?: unknown; slug?: unknown; name?: unknown } | null;
	if (row.status !== "published" || campaign?.slug !== LEGACY_CAMPAIGN_TECHNICAL_SLUG) return null;
	return toPublishedSession({
		...row,
		campaigns: {
			id: campaign.id,
			slug: LEGACY_CAMPAIGN_TECHNICAL_SLUG,
			public_slug: LEGACY_CAMPAIGN_PUBLIC_SLUG,
			name: text(campaign.name, 500) || LEGACY_CAMPAIGN_NAME,
			lifecycle: "active",
			visibility: "public",
		},
	}, detail);
}
