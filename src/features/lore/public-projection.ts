import { formatSessionDate } from "../sessions/model";
import type {
	LoreCampaignContext,
	LoreCardDTO,
	LoreEntityType,
	LoreProfileDTO,
	LoreSectionDTO,
} from "./model";
import { resolveLorePresentation } from "./presentation";
import { loreHrefFor } from "./routes";

export type PublicLoreEntityRow = Readonly<{
	id?: unknown;
	name?: unknown;
	slug?: unknown;
	entity_type?: unknown;
	status?: unknown;
	visibility?: unknown;
	summary?: unknown;
	aliases?: unknown;
}>;

export type PublicCanonEntryRow = Readonly<{
	title?: unknown;
	content?: unknown;
	entry_type?: unknown;
	visibility?: unknown;
	status?: unknown;
}>;

export type PublicLoreSessionRow = Readonly<{
	id?: unknown;
	source_session_id?: unknown;
	title?: unknown;
	session_date?: unknown;
	arc?: unknown;
	summary_short?: unknown;
	status?: unknown;
	campaigns?: unknown;
}>;

export type LoreIndexVisual = Readonly<{
	src: string;
	alt: string;
	focalPoint: Readonly<{ x: number; y: number }>;
}>;

export type LoreIndexItem = Readonly<{
	slug: string;
	entityType: LoreEntityType;
	name: string;
	summary: string;
	href: string;
	campaign: LoreCampaignContext;
	visual?: LoreIndexVisual;
}>;

const ENTITY_TYPES = new Set<LoreEntityType>([
	"pc",
	"npc",
	"location",
	"item",
	"organization",
	"faction",
	"arc",
	"concept",
	"song",
	"quest",
]);

const ENTITY_TYPE_LABELS: Readonly<Record<LoreEntityType, string>> = {
	pc: "Personagem",
	npc: "NPC",
	location: "Lugar",
	item: "Item",
	organization: "Organização",
	faction: "Facção",
	arc: "Arco",
	concept: "Conceito",
	song: "Música",
	quest: "Quest",
};

function cleanText(value: unknown, limit: number) {
	return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function loreEntityType(value: unknown): LoreEntityType | null {
	return typeof value === "string" && ENTITY_TYPES.has(value as LoreEntityType)
		? (value as LoreEntityType)
		: null;
}

function publishedEntityIdentity(
	row: PublicLoreEntityRow,
	campaign: LoreCampaignContext,
) {
	if (row.visibility !== "public_web") return null;
	const slug = cleanText(row.slug, 180);
	const name = cleanText(row.name, 320);
	const entityType = loreEntityType(row.entity_type);
	if (!slug || !name || !entityType) return null;
	const href = loreHrefFor(entityType, slug, campaign.routeKey);
	if (!href) return null;
	return {
		slug,
		name,
		entityType,
		summary: cleanText(row.summary, 12000),
		href,
	};
}

export function toPublicLoreIndexItem(
	row: PublicLoreEntityRow,
	campaign: LoreCampaignContext,
): LoreIndexItem | null {
	const entity = publishedEntityIdentity(row, campaign);
	return entity ? { ...entity, campaign } : null;
}

function canonCards(rows: readonly PublicCanonEntryRow[]): LoreCardDTO[] {
	return rows.flatMap((row, index) => {
		if (row.visibility !== "public_web" || row.status !== "active") return [];
		const title = cleanText(row.title, 500);
		const content = cleanText(row.content, 24000);
		if (!title || !content) return [];
		return [
			{
				id: `canon-${index + 1}`,
				title,
				summary: content,
			},
		];
	});
}

function sessionCards(
	rows: readonly PublicLoreSessionRow[],
	campaign: LoreCampaignContext,
): LoreCardDTO[] {
	return rows.flatMap((row, index) => {
		if (row.status !== "published") return [];
		const linkedCampaign = row.campaigns as { slug?: unknown } | null;
		if (linkedCampaign?.slug !== campaign.technicalSlug) return [];

		const sessionId = cleanText(row.source_session_id, 220);
		const title = cleanText(row.title, 500);
		if (!sessionId || !title) return [];

		const arc = cleanText(row.arc, 300);
		const date = formatSessionDate(cleanText(row.session_date, 10));
		const eyebrow = [arc, date].filter(Boolean).join(" · ");
		const summary = cleanText(row.summary_short, 4000);

		return [
			{
				id: `session-${index + 1}`,
				title,
				...(eyebrow ? { eyebrow } : {}),
				...(summary ? { summary } : {}),
				href: `/campanhas/${encodeURIComponent(campaign.routeKey)}/sessoes/${encodeURIComponent(sessionId)}`,
			},
		];
	});
}

function profileSections(
	summary: string,
	canonRows: readonly PublicCanonEntryRow[],
	sessionRows: readonly PublicLoreSessionRow[],
	campaign: LoreCampaignContext,
): LoreSectionDTO[] {
	const sections: LoreSectionDTO[] = [];
	if (summary) {
		sections.push({
			id: "overview",
			title: "Visão geral",
			blocks: [
				{
					id: "summary",
					kind: "prose",
					paragraphs: [summary],
				},
			],
		});
	}

	const cards = canonCards(canonRows);
	if (cards.length) {
		sections.push({
			id: "canon",
			title: "Memórias canônicas",
			intro: "Registros publicados e aprovados associados a esta memória.",
			blocks: [
				{
					id: "canon-entries",
					kind: "cards",
					items: cards,
				},
			],
		});
	}

	const sessions = sessionCards(sessionRows, campaign);
	if (sessions.length) {
		sections.push({
			id: "sessions",
			title: "Sessões publicadas",
			intro: "Memórias públicas associadas a este perfil.",
			blocks: [
				{
					id: "published-sessions",
					kind: "cards",
					items: sessions,
				},
			],
		});
	}

	return sections;
}

export function buildPublishedLoreProfile(
	row: PublicLoreEntityRow,
	campaign: LoreCampaignContext,
	canonRows: readonly PublicCanonEntryRow[] = [],
	sessionRows: readonly PublicLoreSessionRow[] = [],
): LoreProfileDTO | null {
	const entity = publishedEntityIdentity(row, campaign);
	if (!entity) return null;

	return {
		identity: {
			id: `${campaign.routeKey}:${entity.slug}`,
			slug: entity.slug,
			entityType: entity.entityType,
			name: entity.name,
			eyebrow: ENTITY_TYPE_LABELS[entity.entityType],
			...(entity.summary ? { summary: entity.summary } : {}),
		},
		campaign,
		presentation: resolveLorePresentation({
			motion: {
				preset: "still",
				intensity: 0,
				pointerParallax: false,
				scrollParallax: false,
			},
		}),
		sections: profileSections(entity.summary, canonRows, sessionRows, campaign),
	};
}
