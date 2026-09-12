import {
	WORLD_ENTITY_TYPES,
	type WorldEntityType,
	type WorldGraphDraft,
	type WorldGraphDraftNode,
	type WorldVisibility,
} from "./model";

export const WORLD_DIRECT_CREATE_TYPES = WORLD_ENTITY_TYPES;

const TYPE_LABELS: Record<WorldEntityType, string> = {
	pc: "PC",
	npc: "NPC",
	location: "Lugar",
	faction: "Facção",
	organization: "Organização",
	song: "Música",
	quest: "Quest",
	concept: "Conceito",
	item: "Item",
	arc: "Arco",
	other: "Outro",
};

export function worldEntityTypeLabel(type: WorldEntityType): string {
	return TYPE_LABELS[type];
}

function slugify(value: string): string {
	return value
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/gu, "")
		.toLocaleLowerCase("pt-BR")
		.replace(/[^a-z0-9]+/gu, "-")
		.replace(/^-+|-+$/gu, "")
		.slice(0, 96);
}

function uniqueSlug(base: string, used: Set<string>, fallbackId: string): string {
	const normalized = base || "elemento";
	if (!used.has(normalized)) return normalized;
	for (let index = 2; index < 10000; index += 1) {
		const candidate = `${normalized.slice(0, 88)}-${index}`;
		if (!used.has(candidate)) return candidate;
	}
	return `${normalized.slice(0, 80)}-${fallbackId.slice(0, 8)}`;
}

export function appendWorldDraftNode(
	draft: WorldGraphDraft,
	input: Readonly<{
		id: string;
		name: string;
		entityType: WorldEntityType;
		visibility?: WorldVisibility;
	}>,
): { draft: WorldGraphDraft; node: WorldGraphDraftNode } | null {
	const name = input.name.trim();
	if (!name) return null;
	const usedSlugs = new Set(draft.nodes.flatMap((node) => (node.slug ? [node.slug] : [])));
	const node: WorldGraphDraftNode = {
		id: input.id,
		name,
		slug: uniqueSlug(slugify(name), usedSlugs, input.id),
		entityType: input.entityType,
		status: "active",
		visibility: input.visibility ?? "private_players",
		summary: "",
		aliases: [],
		primaryMediaAssetId: null,
	};
	return {
		node,
		draft: { ...draft, nodes: [...draft.nodes, node] },
	};
}
