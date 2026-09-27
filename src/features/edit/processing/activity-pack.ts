import type {
	ActivityBark,
	ActivityBarkConditions,
	ActivityBarkRequirement,
	BarkFamily,
} from "./activity-barks";

export const ACTIVITY_PACK_SCHEMA = "tda_activity_pack_v1" as const;
export const MAX_ACTIVITY_PACK_BYTES = 2 * 1024 * 1024;
export const MAX_ACTIVITY_PACK_TEMPLATES = 5000;

const ID = /^[a-z0-9][a-z0-9-]{2,63}$/u;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const ALLOWED_EVENTS = new Set([
	"QWEN_WINDOW_TRANSCRIBED",
	"WHISPER_SEGMENT_TRANSCRIBED",
]);
const REQUIREMENTS = new Set<ActivityBarkRequirement>([
	"speaker",
	"window",
	"segment",
	"gpu",
	"profile",
	"attempt",
	"track",
	"total_tracks",
	"gpu_utilization",
]);
const FAMILIES = new Set<BarkFamily>([
	"speaker",
	"devops",
	"rpg",
	"gpu",
	"meta",
]);

export const ACTIVITY_PACK_VARIABLES = [
	{ name: "speaker", type: "string", example: "Faysk", when: "Evento expõe speaker normalizado", nullable: true },
	{ name: "profile", type: "string", example: "qwen-quality", when: "Trabalho possui profile", nullable: true },
	{ name: "attempt", type: "number", example: "2", when: "Evento possui attempt", nullable: true },
	{ name: "track", type: "number", example: "3", when: "Evento expõe track", nullable: true },
	{ name: "total_tracks", type: "number", example: "4", when: "Evento expõe total_tracks", nullable: true },
	{ name: "window", type: "number", example: "205", when: "Evento Qwen expõe window", nullable: true },
	{ name: "segment", type: "number", example: "9", when: "Evento Whisper expõe segment", nullable: true },
	{ name: "gpu", type: "string", example: "RTX 4070", when: "Telemetry GPU está fresca", nullable: true },
	{ name: "gpu_utilization", type: "number", example: "96", when: "Telemetry GPU está fresca", nullable: true },
] as const;

export type ActivityPack = Readonly<{
	schemaVersion: typeof ACTIVITY_PACK_SCHEMA;
	id: string;
	name: string;
	version: string;
	description: string | null;
	author: string | null;
	language: string;
	humorLevel: "light" | "tda";
	enabled: boolean;
	templates: readonly ActivityBark[];
}>;

export class ActivityPackError extends Error {
	constructor(public readonly code: string) {
		super(code);
	}
}

function assertNoForbiddenKeys(value: unknown, depth = 0): void {
	if (depth > 12) throw new ActivityPackError("PACK_DEPTH_EXCEEDED");
	if (!value || typeof value !== "object") return;
	if (Array.isArray(value)) {
		for (const entry of value) assertNoForbiddenKeys(entry, depth + 1);
		return;
	}
	for (const [key, child] of Object.entries(value)) {
		if (FORBIDDEN_KEYS.has(key)) throw new ActivityPackError("PACK_UNSAFE_KEY");
		assertNoForbiddenKeys(child, depth + 1);
	}
}

function object(value: unknown, code = "PACK_OBJECT_REQUIRED"): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new ActivityPackError(code);
	return value as Record<string, unknown>;
}

function hasForbiddenControlCharacters(value: string): boolean {
	for (const character of value) {
		const code = character.charCodeAt(0);
		if (code < 32 && code !== 9 && code !== 10 && code !== 13) return true;
	}
	return false;
}

function text(value: unknown, max: number, code: string): string {
	if (typeof value !== "string") throw new ActivityPackError(code);
	const normalized = value.trim();
	if (
		!normalized ||
		normalized.length > max ||
		hasForbiddenControlCharacters(normalized)
	)
		throw new ActivityPackError(code);
	if (/<\/?[a-z][^>]*>/iu.test(normalized))
		throw new ActivityPackError("PACK_HTML_REJECTED");
	return normalized;
}

function optionalText(value: unknown, max: number, code: string): string | null {
	if (value === undefined || value === null) return null;
	return text(value, max, code);
}

function finiteNumber(value: unknown, code: string): number {
	if (typeof value !== "number" || !Number.isFinite(value))
		throw new ActivityPackError(code);
	return value;
}

function stringArray(value: unknown, code: string, max = 64): string[] {
	if (!Array.isArray(value) || value.length > 64)
		throw new ActivityPackError(code);
	return value.map((entry) => text(entry, max, code));
}

function placeholders(value: string): ActivityBarkRequirement[] {
	const found = [...value.matchAll(/\{([a-z0-9_]+)\}/giu)].map(
		(match) => match[1] ?? "",
	);
	for (const name of found) {
		if (!REQUIREMENTS.has(name as ActivityBarkRequirement))
			throw new ActivityPackError("PACK_PLACEHOLDER_UNSUPPORTED");
	}
	return [...new Set(found)] as ActivityBarkRequirement[];
}

function parseConditions(value: unknown): ActivityBarkConditions | undefined {
	if (value === undefined) return undefined;
	const input = object(value, "PACK_CONDITIONS_INVALID");
	const allowed = new Set([
		"speaker",
		"profile",
		"window_min",
		"window_max",
		"gpu_utilization_min",
		"attempt_min",
	]);
	for (const key of Object.keys(input)) {
		if (!allowed.has(key)) throw new ActivityPackError("PACK_CONDITION_UNSUPPORTED");
	}
	const speaker =
		input.speaker === undefined
			? undefined
			: stringArray(input.speaker, "PACK_CONDITIONS_INVALID").map((item) =>
					item.toLocaleLowerCase("pt-BR"),
				);
	const profile =
		input.profile === undefined
			? undefined
			: stringArray(input.profile, "PACK_CONDITIONS_INVALID");
	const windowMin =
		input.window_min === undefined
			? undefined
			: finiteNumber(input.window_min, "PACK_CONDITIONS_INVALID");
	const windowMax =
		input.window_max === undefined
			? undefined
			: finiteNumber(input.window_max, "PACK_CONDITIONS_INVALID");
	const gpuUtilizationMin =
		input.gpu_utilization_min === undefined
			? undefined
			: finiteNumber(input.gpu_utilization_min, "PACK_CONDITIONS_INVALID");
	const attemptMin =
		input.attempt_min === undefined
			? undefined
			: finiteNumber(input.attempt_min, "PACK_CONDITIONS_INVALID");
	if (windowMin !== undefined && windowMax !== undefined && windowMin > windowMax)
		throw new ActivityPackError("PACK_CONDITIONS_INVALID");
	if (
		gpuUtilizationMin !== undefined &&
		(gpuUtilizationMin < 0 || gpuUtilizationMin > 100)
	)
		throw new ActivityPackError("PACK_CONDITIONS_INVALID");
	if (attemptMin !== undefined && attemptMin < 0)
		throw new ActivityPackError("PACK_CONDITIONS_INVALID");
	return {
		speaker,
		profile,
		windowMin,
		windowMax,
		gpuUtilizationMin,
		attemptMin,
	};
}

export function parseActivityPackJson(raw: string): ActivityPack {
	if (new TextEncoder().encode(raw).byteLength > MAX_ACTIVITY_PACK_BYTES)
		throw new ActivityPackError("PACK_TOO_LARGE");

	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		throw new ActivityPackError("PACK_JSON_INVALID");
	}
	assertNoForbiddenKeys(value);

	const root = object(value);
	const allowedRoot = new Set([
		"schema_version",
		"id",
		"name",
		"version",
		"description",
		"author",
		"language",
		"humor_level",
		"enabled",
		"templates",
	]);
	for (const key of Object.keys(root)) {
		if (!allowedRoot.has(key)) throw new ActivityPackError("PACK_FIELD_UNSUPPORTED");
	}
	if (root.schema_version !== ACTIVITY_PACK_SCHEMA)
		throw new ActivityPackError("PACK_SCHEMA_UNSUPPORTED");

	const id = text(root.id, 64, "PACK_ID_INVALID");
	if (!ID.test(id)) throw new ActivityPackError("PACK_ID_INVALID");

	if (
		!Array.isArray(root.templates) ||
		root.templates.length < 1 ||
		root.templates.length > MAX_ACTIVITY_PACK_TEMPLATES
	)
		throw new ActivityPackError("PACK_TEMPLATE_COUNT_INVALID");

	const seen = new Set<string>();
	const templates = root.templates.map((entry): ActivityBark => {
		const item = object(entry, "PACK_TEMPLATE_INVALID");
		const allowed = new Set([
			"id",
			"family",
			"tone",
			"event_codes",
			"requires",
			"conditions",
			"text",
		]);
		for (const key of Object.keys(item)) {
			if (!allowed.has(key))
				throw new ActivityPackError("PACK_TEMPLATE_FIELD_UNSUPPORTED");
		}

		const templateId = text(item.id, 64, "PACK_TEMPLATE_ID_INVALID");
		if (!ID.test(templateId) || seen.has(templateId))
			throw new ActivityPackError("PACK_TEMPLATE_ID_INVALID");
		seen.add(templateId);

		const family = text(item.family, 32, "PACK_FAMILY_INVALID") as BarkFamily;
		if (!FAMILIES.has(family)) throw new ActivityPackError("PACK_FAMILY_INVALID");

		if (item.tone !== "light" && item.tone !== "tda")
			throw new ActivityPackError("PACK_TONE_INVALID");

		const eventCodes = stringArray(item.event_codes, "PACK_EVENT_INVALID", 96);
		if (!eventCodes.length || eventCodes.some((event) => !ALLOWED_EVENTS.has(event)))
			throw new ActivityPackError("PACK_EVENT_NOT_HUMOROUS");

		const body = text(item.text, 500, "PACK_TEXT_INVALID");
		const implied = placeholders(body);
		let requires = implied;
		if (item.requires !== undefined) {
			const declared = stringArray(item.requires, "PACK_REQUIRES_INVALID", 32);
			if (
				declared.some(
					(requirement) => !REQUIREMENTS.has(requirement as ActivityBarkRequirement),
				)
			)
				throw new ActivityPackError("PACK_REQUIRES_INVALID");
			if (implied.some((required) => !declared.includes(required)))
				throw new ActivityPackError("PACK_REQUIRES_MISSING");
			requires = declared as ActivityBarkRequirement[];
		}

		return {
			packId: id,
			id: templateId,
			family,
			tone: item.tone,
			eventCodes,
			requires,
			conditions: parseConditions(item.conditions),
			text: body,
		};
	});

	if (root.humor_level !== "light" && root.humor_level !== "tda")
		throw new ActivityPackError("PACK_HUMOR_LEVEL_INVALID");

	return {
		schemaVersion: ACTIVITY_PACK_SCHEMA,
		id,
		name: text(root.name, 120, "PACK_NAME_INVALID"),
		version: text(root.version, 32, "PACK_VERSION_INVALID"),
		description: optionalText(root.description, 500, "PACK_DESCRIPTION_INVALID"),
		author: optionalText(root.author, 120, "PACK_AUTHOR_INVALID"),
		language: text(root.language, 16, "PACK_LANGUAGE_INVALID"),
		humorLevel: root.humor_level,
		enabled: root.enabled === true,
		templates,
	};
}

export function activityPackJsonValue(pack: ActivityPack, enabled = pack.enabled) {
	return {
		schema_version: pack.schemaVersion,
		id: pack.id,
		name: pack.name,
		version: pack.version,
		description: pack.description,
		author: pack.author,
		language: pack.language,
		humor_level: pack.humorLevel,
		enabled,
		templates: pack.templates.map((item) => ({
			id: item.id,
			family: item.family,
			tone: item.tone,
			event_codes: item.eventCodes,
			requires: item.requires,
			conditions: item.conditions
				? {
						speaker: item.conditions.speaker,
						profile: item.conditions.profile,
						window_min: item.conditions.windowMin,
						window_max: item.conditions.windowMax,
						gpu_utilization_min: item.conditions.gpuUtilizationMin,
						attempt_min: item.conditions.attemptMin,
					}
				: undefined,
			text: item.text,
		})),
	};
}

export function serializeActivityPack(pack: ActivityPack, enabled = pack.enabled): string {
	return JSON.stringify(activityPackJsonValue(pack, enabled), null, 2);
}

export function activityPackExample(): string {
	return JSON.stringify(
		{
			schema_version: ACTIVITY_PACK_SCHEMA,
			id: "faysk-chaos-pack",
			name: "Faysk Chaos Pack",
			version: "1.0.0",
			description: "Roasts locais para eventos rotineiros do processamento.",
			author: "Faysk",
			language: "pt-BR",
			humor_level: "tda",
			enabled: false,
			templates: [
				{
					id: "faysk-grammar-001",
					family: "speaker",
					tone: "tda",
					event_codes: ["QWEN_WINDOW_TRANSCRIBED"],
					requires: ["speaker"],
					conditions: { speaker: ["faysk"] },
					text: "{speaker} abriu a boca. O glossário abriu um chamado.",
				},
				{
					id: "gpu-heat-003",
					family: "gpu",
					tone: "tda",
					event_codes: ["QWEN_WINDOW_TRANSCRIBED"],
					requires: ["gpu", "gpu_utilization"],
					conditions: { gpu_utilization_min: 90 },
					text: "{gpu} chegou a {gpu_utilization}%. Ela claramente não foi consultada.",
				},
			],
		},
		null,
		2,
	);
}

export function activityPackPrompt(): string {
	const variables = ACTIVITY_PACK_VARIABLES.map((item) => `{${item.name}}`).join(", ");
	return [
		`Crie um JSON válido conforme ${ACTIVITY_PACK_SCHEMA}.`,
		"",
		"Quero um pack pt-BR com humor TDA, variedade alta e sem repetir frases.",
		"Use somente eventos rotineiros de sucesso: QWEN_WINDOW_TRANSCRIBED e WHISPER_SEGMENT_TRANSCRIBED.",
		`Use somente estas variáveis: ${variables}.`,
		"Conditions permitidas: speaker, profile, window_min, window_max, gpu_utilization_min, attempt_min.",
		"Não use HTML, Markdown, JavaScript, regex, URLs executáveis ou campos extras.",
		"Retorne APENAS JSON válido, sem bloco de código.",
		"",
		"Exemplo de schema:",
		activityPackExample(),
	].join("\n");
}
