import { isWorldEntityMediaAssetId } from "./world-entity-media";
import {
	WORLD_ENTITY_TYPES,
	WORLD_VISIBILITIES,
	type WorldGraphDraft,
	type WorldLineStyle,
	type WorldRelationDirection,
	type WorldRelationFamily,
} from "./model";

const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,95}$/u;
const TYPE_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const HEX_PATTERN = /^#[0-9a-f]{6}$/iu;
const ENTITY_TYPES = new Set(WORLD_ENTITY_TYPES);
const VISIBILITIES = new Set(WORLD_VISIBILITIES);
const DIRECTIONS = new Set<WorldRelationDirection>(["directed", "symmetric"]);
const FAMILIES = new Set<WorldRelationFamily>([
	"affinity",
	"family",
	"conflict",
	"authority",
	"faction",
	"origin",
	"mystic",
	"creative",
	"context",
]);
const LINE_STYLES = new Set<WorldLineStyle>(["solid", "dashed", "dotted"]);
const RELATION_STATUSES = new Set([
	"active",
	"ended",
	"superseded",
	"retcon_pending",
	"archived",
]);

export type WorldGraphValidationIssue = Readonly<{
	path: string;
	code: string;
	message: string;
}>;

function issue(path: string, code: string, message: string): WorldGraphValidationIssue {
	return { path, code, message };
}

function duplicateValues(values: readonly string[]): Set<string> {
	const seen = new Set<string>();
	const duplicates = new Set<string>();
	for (const value of values) {
		if (seen.has(value)) duplicates.add(value);
		seen.add(value);
	}
	return duplicates;
}

export function worldGraphDraftValidationIssues(
	draft: WorldGraphDraft,
): WorldGraphValidationIssue[] {
	const issues: WorldGraphValidationIssue[] = [];
	if (draft.schemaVersion !== 1) {
		issues.push(issue("schemaVersion", "schema", "A versão interna do rascunho não é suportada."));
	}
	if (!Number.isSafeInteger(draft.revision) || draft.revision < 0) {
		issues.push(issue("revision", "revision", "A revisão-base do rascunho é inválida."));
	}
	if (draft.nodes.length > 1000) {
		issues.push(issue("nodes", "limit", "O rascunho excede o limite de 1000 elementos."));
	}
	if (draft.edges.length > 5000) {
		issues.push(issue("edges", "limit", "O rascunho excede o limite de 5000 ligações."));
	}
	if (draft.relationTypes.length > 200) {
		issues.push(issue("relationTypes", "limit", "O rascunho excede o limite de 200 tipos de ligação."));
	}

	for (const [index, node] of draft.nodes.entries()) {
		const label = node.name.trim() || `elemento #${index + 1}`;
		const base = `nodes.${node.id || index}`;
		if (!UUID_PATTERN.test(node.id)) {
			issues.push(issue(`${base}.id`, "uuid", `Elemento “${label}”: identificador interno inválido.`));
		}
		if (node.name.trim().length < 1) {
			issues.push(issue(`${base}.name`, "required", `Elemento #${index + 1} → Nome: obrigatório.`));
		} else if (node.name.trim().length > 160) {
			issues.push(issue(`${base}.name`, "max_length", `Elemento “${label}” → Nome: máximo de 160 caracteres.`));
		}
		if (node.slug && !SLUG_PATTERN.test(node.slug)) {
			issues.push(issue(`${base}.slug`, "format", `Elemento “${label}” → Slug: formato inválido.`));
		}
		if (!ENTITY_TYPES.has(node.entityType)) {
			issues.push(issue(`${base}.entityType`, "enum", `Elemento “${label}” → Tipo: valor inválido.`));
		}
		if (node.status.length < 1 || node.status.length > 32) {
			issues.push(issue(`${base}.status`, "length", `Elemento “${label}” → Status: valor inválido.`));
		}
		if (!VISIBILITIES.has(node.visibility)) {
			issues.push(issue(`${base}.visibility`, "enum", `Elemento “${label}” → Visibilidade: valor inválido.`));
		}
		if (node.summary.length > 4000) {
			issues.push(issue(`${base}.summary`, "max_length", `Elemento “${label}” → Resumo: máximo de 4000 caracteres.`));
		}
		if (node.aliases.length > 50) {
			issues.push(issue(`${base}.aliases`, "limit", `Elemento “${label}” → Aliases: máximo de 50 nomes.`));
		}
		for (const [aliasIndex, alias] of node.aliases.entries()) {
			if (alias.length < 1 || alias.length > 160) {
				issues.push(issue(`${base}.aliases.${aliasIndex}`, "length", `Elemento “${label}” → Alias #${aliasIndex + 1}: use entre 1 e 160 caracteres.`));
			}
		}
		if (node.primaryMediaAssetId !== undefined && node.primaryMediaAssetId !== null) {
			if (!isWorldEntityMediaAssetId(node.primaryMediaAssetId)) {
				issues.push(issue(`${base}.primaryMediaAssetId`, "media", `Elemento “${label}” → Imagem: identificador inválido.`));
			}
		}
		if (node.primaryMediaAssetId === null && node.primaryMediaFocalPoint) {
			issues.push(issue(`${base}.primaryMediaFocalPoint`, "media", `Elemento “${label}” → Foco da imagem existe sem uma imagem vinculada.`));
		}
		if (node.primaryMediaFocalPoint) {
			const { x, y } = node.primaryMediaFocalPoint;
			if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
				issues.push(issue(`${base}.primaryMediaFocalPoint`, "range", `Elemento “${label}” → Foco da imagem: posição inválida.`));
			}
		}
	}

	const duplicateNodeIds = duplicateValues(draft.nodes.map((node) => node.id));
	for (const id of duplicateNodeIds) {
		issues.push(issue("nodes", "duplicate_id", `Existem dois elementos com o mesmo identificador interno (${id}).`));
	}
	const duplicateNodeNames = duplicateValues(draft.nodes.map((node) => node.name.trim()));
	for (const name of duplicateNodeNames) {
		if (name) issues.push(issue("nodes", "duplicate_name", `Existem dois elementos com o nome “${name}”.`));
	}
	const duplicateNodeSlugs = duplicateValues(
		draft.nodes.flatMap((node) => (node.slug ? [node.slug] : [])),
	);
	for (const slug of duplicateNodeSlugs) {
		issues.push(issue("nodes", "duplicate_slug", `Existem dois elementos usando o slug “${slug}”.`));
	}

	for (const [index, type] of draft.relationTypes.entries()) {
		const label = type.label.trim() || `tipo #${index + 1}`;
		const base = `relationTypes.${type.slug || index}`;
		if (!TYPE_SLUG_PATTERN.test(type.slug)) {
			issues.push(issue(`${base}.slug`, "format", `Tipo “${label}” → Identificador: formato inválido.`));
		}
		if (type.label.trim().length < 1) {
			issues.push(issue(`${base}.label`, "required", `Tipo de ligação #${index + 1} → Nome: obrigatório.`));
		} else if (type.label.trim().length > 80) {
			issues.push(issue(`${base}.label`, "max_length", `Tipo “${label}” → Nome: máximo de 80 caracteres.`));
		}
		if (!DIRECTIONS.has(type.direction)) {
			issues.push(issue(`${base}.direction`, "enum", `Tipo “${label}” → Direção: valor inválido.`));
		}
		if (!FAMILIES.has(type.family)) {
			issues.push(issue(`${base}.family`, "enum", `Tipo “${label}” → Família: valor inválido.`));
		}
		if (type.description.length > 1000) {
			issues.push(issue(`${base}.description`, "max_length", `Tipo “${label}” → Descrição: máximo de 1000 caracteres.`));
		}
		if (!HEX_PATTERN.test(type.color)) {
			issues.push(issue(`${base}.color`, "format", `Tipo “${label}” → Cor: valor inválido.`));
		}
		if (!LINE_STYLES.has(type.lineStyle)) {
			issues.push(issue(`${base}.lineStyle`, "enum", `Tipo “${label}” → Traço: valor inválido.`));
		}
		if (!Number.isFinite(type.lineWidth) || type.lineWidth < 1 || type.lineWidth > 8) {
			issues.push(issue(`${base}.lineWidth`, "range", `Tipo “${label}” → Espessura: use um valor entre 1 e 8.`));
		}
	}
	const duplicateTypeSlugs = duplicateValues(draft.relationTypes.map((type) => type.slug));
	for (const slug of duplicateTypeSlugs) {
		issues.push(issue("relationTypes", "duplicate_slug", `Existem dois tipos de ligação usando o identificador “${slug}”.`));
	}

	const nodeIds = new Set(draft.nodes.map((node) => node.id));
	const typeBySlug = new Map(draft.relationTypes.map((type) => [type.slug, type]));
	for (const [index, edge] of draft.edges.entries()) {
		const type = typeBySlug.get(edge.relationType);
		const typeLabel = type?.label ?? edge.relationType ?? `ligação #${index + 1}`;
		const base = `edges.${edge.id || index}`;
		if (!UUID_PATTERN.test(edge.id)) {
			issues.push(issue(`${base}.id`, "uuid", `Ligação “${typeLabel}”: identificador interno inválido.`));
		}
		if (!UUID_PATTERN.test(edge.source) || !UUID_PATTERN.test(edge.target)) {
			issues.push(issue(base, "endpoint", `Ligação “${typeLabel}”: origem ou destino inválido.`));
		} else if (edge.source === edge.target) {
			issues.push(issue(base, "self_edge", `Ligação “${typeLabel}”: um elemento não pode se conectar a ele mesmo.`));
		}
		if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
			issues.push(issue(base, "missing_node", `Ligação “${typeLabel}”: um dos elementos conectados não existe mais no rascunho.`));
		}
		if (!TYPE_SLUG_PATTERN.test(edge.relationType) || !typeBySlug.has(edge.relationType)) {
			issues.push(issue(`${base}.relationType`, "missing_type", `Ligação #${index + 1}: o tipo “${edge.relationType}” não existe no rascunho.`));
		}
		if (!RELATION_STATUSES.has(edge.status)) {
			issues.push(issue(`${base}.status`, "enum", `Ligação “${typeLabel}” → Status: valor inválido.`));
		}
		if (!VISIBILITIES.has(edge.visibility)) {
			issues.push(issue(`${base}.visibility`, "enum", `Ligação “${typeLabel}” → Visibilidade: valor inválido.`));
		}
		if (edge.labelOverride !== null && edge.labelOverride.length > 120) {
			issues.push(issue(`${base}.labelOverride`, "max_length", `Ligação “${typeLabel}” → Nome específico: máximo de 120 caracteres.`));
		}
		if (edge.colorOverride !== null && !HEX_PATTERN.test(edge.colorOverride)) {
			issues.push(issue(`${base}.colorOverride`, "format", `Ligação “${typeLabel}” → Cor específica: valor inválido.`));
		}
		if (edge.lineStyleOverride !== null && !LINE_STYLES.has(edge.lineStyleOverride)) {
			issues.push(issue(`${base}.lineStyleOverride`, "enum", `Ligação “${typeLabel}” → Traço específico: valor inválido.`));
		}
		if (
			edge.lineWidthOverride !== null &&
			(!Number.isFinite(edge.lineWidthOverride) ||
				edge.lineWidthOverride < 1 ||
				edge.lineWidthOverride > 8)
		) {
			issues.push(issue(`${base}.lineWidthOverride`, "range", `Ligação “${typeLabel}” → Espessura específica: use um valor entre 1 e 8.`));
		}
	}
	const duplicateEdgeIds = duplicateValues(draft.edges.map((edge) => edge.id));
	for (const id of duplicateEdgeIds) {
		issues.push(issue("edges", "duplicate_id", `Existem duas ligações com o mesmo identificador interno (${id}).`));
	}

	const semanticEdges = new Map<string, string>();
	for (const edge of draft.edges) {
		if (edge.status !== "active") continue;
		const type = typeBySlug.get(edge.relationType);
		if (!type) continue;
		const endpoints =
			type.direction === "symmetric"
				? [edge.source, edge.target].sort().join(":")
				: `${edge.source}:${edge.target}`;
		const key = `${edge.relationType}:${endpoints}`;
		if (semanticEdges.has(key)) {
			issues.push(issue("edges", "duplicate_relation", `A ligação ativa “${type.label}” está duplicada entre os mesmos elementos.`));
		} else {
			semanticEdges.set(key, edge.id);
		}
	}

	return issues;
}

export function firstWorldGraphDraftValidationIssue(
	draft: WorldGraphDraft,
): WorldGraphValidationIssue | null {
	return worldGraphDraftValidationIssues(draft)[0] ?? null;
}
