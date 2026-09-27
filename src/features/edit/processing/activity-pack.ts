import {
	CORE_ACTIVITY_BARKS,
	type ActivityBark,
	type BarkFamily,
} from "./activity-barks";

export const ACTIVITY_PACK_SCHEMA = "tda_activity_pack_v1" as const;
export const ACTIVITY_PACK_LIBRARY_VERSION = "tda_activity_pack_library_v1" as const;
export const ACTIVITY_PACK_STORAGE_EVENT = "tda:activity-packs-changed";
export const MAX_ACTIVITY_PACK_BYTES = 2 * 1024 * 1024;
export const MAX_ACTIVITY_PACK_TEMPLATES = 5000;

const PACK_ID = /^[a-z0-9][a-z0-9-]{2,63}$/u;
const ALLOWED_EVENTS = new Set([
	"QWEN_WINDOW_TRANSCRIBED",
	"WHISPER_SEGMENT_TRANSCRIBED",
]);
const ALLOWED_PLACEHOLDERS = new Set(["speaker", "window", "segment", "gpu"]);
const ALLOWED_FAMILIES = new Set<BarkFamily>([
	"speaker",
	"devops",
	"rpg",
	"gpu",
	"meta",
]);

export type ActivityPackTemplate = Readonly<{
	id: string;
	family: BarkFamily;
	tone: "light" | "tda";
	eventCodes: readonly string[];
	requires: readonly ("speaker" | "window" | "segment" | "gpu")[];
	text: string;
}>;

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
	canonicalSha256: string;
	templates: readonly ActivityPackTemplate[];
}>;

export class ActivityPackError extends Error {
	constructor(public readonly code: string) {
		super(code);
	}
}

function strictObject(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new ActivityPackError("PACK_OBJECT_REQUIRED");
	for (const key of ["__proto__", "constructor", "prototype"]) {
		if (Object.prototype.hasOwnProperty.call(value, key))
			throw new ActivityPackError("PACK_UNSAFE_KEY");
	}
	return value as Record<string, unknown>;
}

function text(value: unknown, max: number, code: string): string {
	if (typeof value !== "string") throw new ActivityPackError(code);
	const normalized = value.trim();
	if (
		!normalized ||
		normalized.length > max ||
		/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(normalized)
	)
		throw new ActivityPackError(code);
	if (/<\/?[a-z][^>]*>/iu.test(normalized))
		throw new ActivityPackError("PACK_HTML_REJECTED");
	return normalized;
}

function optionalText(
	value: unknown,
	max: number,
	code: string,
): string | null {
	return value === undefined || value === null ? null : text(value, max, code);
}

function templatePlaceholders(value: string) {
	const matches = [...value.matchAll(/\{([a-z0-9_]+)\}/giu)].map(
		(match) => match[1] ?? "",
	);
	for (const placeholder of matches) {
		if (!ALLOWED_PLACEHOLDERS.has(placeholder))
			throw new ActivityPackError("PACK_PLACEHOLDER_UNSUPPORTED");
	}
	return [...new Set(matches)];
}

function canonicalPayload(pack: Omit<ActivityPack, "canonicalSha256">) {
	return {
		schema_version: pack.schemaVersion,
		id: pack.id,
		name: pack.name,
		version: pack.version,
		description: pack.description,
		author: pack.author,
		language: pack.language,
		humor_level: pack.humorLevel,
		enabled: pack.enabled,
		templates: pack.templates.map((item) => ({
			id: item.id,
			family: item.family,
			tone: item.tone,
			event_codes: [...item.eventCodes],
			requires: [...item.requires],
			text: item.text,
		})),
	};
}

export function canonicalActivityPackJson(
	pack: Omit<ActivityPack, "canonicalSha256">,
): string {
	return JSON.stringify(canonicalPayload(pack));
}

export async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(value),
	);
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

export async function parseActivityPackJson(
	raw: string,
	options: Readonly<{ preserveEnabled?: boolean }> = {},
): Promise<ActivityPack> {
	if (new TextEncoder().encode(raw).byteLength > MAX_ACTIVITY_PACK_BYTES)
		throw new ActivityPackError("PACK_TOO_LARGE");

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new ActivityPackError("PACK_JSON_INVALID");
	}

	const root = strictObject(parsed);
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
		"canonical_sha256",
		"templates",
	]);
	for (const key of Object.keys(root)) {
		if (!allowedRoot.has(key))
			throw new ActivityPackError("PACK_FIELD_UNSUPPORTED");
	}
	if (root.schema_version !== ACTIVITY_PACK_SCHEMA)
		throw new ActivityPackError("PACK_SCHEMA_UNSUPPORTED");

	const id = text(root.id, 64, "PACK_ID_INVALID");
	if (!PACK_ID.test(id)) throw new ActivityPackError("PACK_ID_INVALID");

	if (!Array.isArray(root.templates) || root.templates.length === 0)
		throw new ActivityPackError("PACK_TEMPLATE_COUNT_INVALID");
	if (root.templates.length > MAX_ACTIVITY_PACK_TEMPLATES)
		throw new ActivityPackError("PACK_TEMPLATE_COUNT_INVALID");

	const seen = new Set<string>();
	const templates = root.templates.map((entry): ActivityPackTemplate => {
		const item = strictObject(entry);
		const allowed = new Set([
			"id",
			"family",
			"tone",
			"event_codes",
			"requires",
			"text",
		]);
		for (const key of Object.keys(item)) {
			if (!allowed.has(key))
				throw new ActivityPackError("PACK_TEMPLATE_FIELD_UNSUPPORTED");
		}

		const templateId = text(item.id, 64, "PACK_TEMPLATE_ID_INVALID");
		if (!PACK_ID.test(templateId) || seen.has(templateId))
			throw new ActivityPackError("PACK_TEMPLATE_ID_INVALID");
		seen.add(templateId);

		const family = text(item.family, 32, "PACK_FAMILY_INVALID") as BarkFamily;
		if (!ALLOWED_FAMILIES.has(family))
			throw new ActivityPackError("PACK_FAMILY_INVALID");

		if (item.tone !== "light" && item.tone !== "tda")
			throw new ActivityPackError("PACK_TONE_INVALID");

		if (!Array.isArray(item.event_codes) || item.event_codes.length === 0)
			throw new ActivityPackError("PACK_EVENT_INVALID");
		const eventCodes = item.event_codes.map((event) =>
			text(event, 96, "PACK_EVENT_INVALID"),
		);
		if (eventCodes.some((event) => !ALLOWED_EVENTS.has(event)))
			throw new ActivityPackError("PACK_EVENT_NOT_HUMOROUS");

		const templateText = text(item.text, 500, "PACK_TEXT_INVALID");
		const implied = templatePlaceholders(templateText);
		let requires = implied;
		if (item.requires !== undefined) {
			if (!Array.isArray(item.requires))
				throw new ActivityPackError("PACK_REQUIRES_INVALID");
			const declared = item.requires.map((entry) =>
				text(entry, 32, "PACK_REQUIRES_INVALID"),
			);
			if (declared.some((entry) => !ALLOWED_PLACEHOLDERS.has(entry)))
				throw new ActivityPackError("PACK_REQUIRES_INVALID");
			if (implied.some((entry) => !declared.includes(entry)))
				throw new ActivityPackError("PACK_REQUIRES_MISSING");
			requires = declared;
		}

		return {
			id: templateId,
			family,
			tone: item.tone,
			eventCodes,
			requires: requires as ActivityPackTemplate["requires"],
			text: templateText,
		};
	});

	if (root.humor_level !== "light" && root.humor_level !== "tda")
		throw new ActivityPackError("PACK_HUMOR_LEVEL_INVALID");
	if (root.enabled !== undefined && typeof root.enabled !== "boolean")
		throw new ActivityPackError("PACK_ENABLED_INVALID");

	const withoutHash: Omit<ActivityPack, "canonicalSha256"> = {
		schemaVersion: ACTIVITY_PACK_SCHEMA,
		id,
		name: text(root.name, 120, "PACK_NAME_INVALID"),
		version: text(root.version, 32, "PACK_VERSION_INVALID"),
		description: optionalText(
			root.description,
			500,
			"PACK_DESCRIPTION_INVALID",
		),
		author: optionalText(root.author, 120, "PACK_AUTHOR_INVALID"),
		language: text(root.language, 16, "PACK_LANGUAGE_INVALID"),
		humorLevel: root.humor_level,
		// Imported files are untrusted: enabled=true never self-activates.
		enabled: options.preserveEnabled ? root.enabled === true : false,
		templates,
	};
	const canonicalSha256 = await sha256Hex(
		canonicalActivityPackJson(withoutHash),
	);
	if (
		root.canonical_sha256 !== undefined &&
		options.preserveEnabled &&
		root.canonical_sha256 !== canonicalSha256
	)
		throw new ActivityPackError("PACK_HASH_MISMATCH");

	return { ...withoutHash, canonicalSha256 };
}

export function exportActivityPack(pack: ActivityPack) {
	return JSON.stringify(
		{
			...canonicalPayload(pack),
			canonical_sha256: pack.canonicalSha256,
		},
		null,
		2,
	);
}

export function activityPackCatalog(
	packs: readonly ActivityPack[],
): readonly ActivityBark[] {
	const custom: ActivityBark[] = [];
	for (const pack of packs) {
		if (!pack.enabled) continue;
		for (const template of pack.templates) {
			custom.push({
				id: `${pack.id}:${template.id}`,
				family: template.family,
				tone: template.tone,
				eventCodes: template.eventCodes,
				requires: template.requires,
				text: template.text,
			});
		}
	}
	return [...CORE_ACTIVITY_BARKS, ...custom];
}

export const ACTIVITY_PACK_VARIABLES = [
	{ name: "speaker", example: "Faysk", when: "speaker disponível" },
	{ name: "window", example: "205", when: "evento Qwen com janela" },
	{ name: "segment", example: "42", when: "evento Whisper com segmento" },
	{ name: "gpu", example: "RTX 4070", when: "telemetria de GPU disponível" },
] as const;

export function activityPackExample(): string {
	return JSON.stringify(
		{
			schema_version: ACTIVITY_PACK_SCHEMA,
			id: "faysk-chaos-pack",
			name: "Faysk Chaos Pack",
			version: "1.0.0",
			description: "Roasts, DevOps, RPG e absurdos.",
			author: "Faysk",
			language: "pt-BR",
			humor_level: "tda",
			enabled: true,
			templates: [
				{
					id: "grammar-001",
					family: "speaker",
					tone: "tda",
					event_codes: ["QWEN_WINDOW_TRANSCRIBED"],
					requires: ["speaker"],
					text: "{speaker} abriu a boca. O glossário abriu um chamado.",
				},
			],
		},
		null,
		2,
	);
}
