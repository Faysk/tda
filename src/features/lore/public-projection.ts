import type {
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

export type LoreIndexItem = Readonly<{
	slug: string;
	entityType: LoreEntityType;
	name: string;
	summary: string;
	href: string;
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

function cleanText(value: unknown, limit: number) {
	return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function loreEntityType(value: unknown): LoreEntityType | null {
	return typeof value === "string" && ENTITY_TYPES.has(value as LoreEntityType)
		? (value as LoreEntityType)
		: null;
}

function publishedEntityIdentity(row: PublicLoreEntityRow) {
	if (row.visibility !== "public_web") return null;
	const slug = cleanText(row.slug, 180);
	const name = cleanText(row.name, 320);
	const entityType = loreEntityType(row.entity_type);
	if (!slug || !name || !entityType) return null;
	const href = loreHrefFor(entityType, slug);
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
): LoreIndexItem | null {
	return publishedEntityIdentity(row);
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

function profileSections(
	summary: string,
	canonRows: readonly PublicCanonEntryRow[],
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

	return sections;
}

export function buildPublishedLoreProfile(
	row: PublicLoreEntityRow,
	canonRows: readonly PublicCanonEntryRow[] = [],
): LoreProfileDTO | null {
	const entity = publishedEntityIdentity(row);
	if (!entity) return null;

	return {
		identity: {
			id: entity.slug,
			slug: entity.slug,
			entityType: entity.entityType,
			name: entity.name,
			...(entity.summary ? { summary: entity.summary } : {}),
		},
		presentation: resolveLorePresentation({
			motion: {
				preset: "still",
				intensity: 0,
				pointerParallax: false,
				scrollParallax: false,
			},
		}),
		sections: profileSections(entity.summary, canonRows),
	};
}
