import type { ActivityBark, BarkFamily } from "./activity-barks";

export const ACTIVITY_PACK_SCHEMA = "tda_activity_pack_v1" as const;
export const MAX_ACTIVITY_PACK_BYTES = 2 * 1024 * 1024;
export const MAX_ACTIVITY_PACK_TEMPLATES = 5000;

const ID = /^[a-z0-9][a-z0-9-]{2,63}$/u;
const ALLOWED_EVENTS = new Set([
	"QWEN_WINDOW_TRANSCRIBED",
	"WHISPER_SEGMENT_TRANSCRIBED",
]);
const ALLOWED_PLACEHOLDERS = new Set(["speaker", "window", "segment", "gpu"]);
const FAMILIES = new Set<BarkFamily>([
	"speaker",
	"devops",
	"rpg",
	"gpu",
	"meta",
]);

export type ActivityPack = Readonly<{
	schemaVersion: typeof ACTIVITY_PACK_SCHEMA;
	id: string;
	name: string;
	version: string;
	description: string | null;
	author: string | null;
	language: string;
	humorLevel: "light" | "tda";
	templates: readonly ActivityBark[];
}>;

export class ActivityPackError extends Error {
	constructor(public readonly code: string) {
		super(code);
	}
}

function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new ActivityPackError("PACK_OBJECT_REQUIRED");
	for (const key of ["__proto__", "constructor", "prototype"]) {
		if (Object.prototype.hasOwnProperty.call(value, key))
			throw new ActivityPackError("PACK_UNSAFE_KEY");
	}
	return value as Record<string, unknown>;
}

function string(value: unknown, max: number, code: string): string {
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

function optionalString(
	value: unknown,
	max: number,
	code: string,
): string | null {
	if (value === undefined || value === null) return null;
	return string(value, max, code);
}

function placeholders(text: string): string[] {
	const values = [...text.matchAll(/\{([a-z0-9_]+)\}/giu)].map(
		(match) => match[1] ?? "",
	);
	for (const value of values) {
		if (!ALLOWED_PLACEHOLDERS.has(value))
			throw new ActivityPackError("PACK_PLACEHOLDER_UNSUPPORTED");
	}
	return [...new Set(values)];
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
		if (!allowedRoot.has(key))
			throw new ActivityPackError("PACK_FIELD_UNSUPPORTED");
	}

	if (root.schema_version !== ACTIVITY_PACK_SCHEMA)
		throw new ActivityPackError("PACK_SCHEMA_UNSUPPORTED");

	const id = string(root.id, 64, "PACK_ID_INVALID");
	if (!ID.test(id)) throw new ActivityPackError("PACK_ID_INVALID");

	const templates = root.templates;
	if (
		!Array.isArray(templates) ||
		!templates.length ||
		templates.length > MAX_ACTIVITY_PACK_TEMPLATES
	)
		throw new ActivityPackError("PACK_TEMPLATE_COUNT_INVALID");

	const seen = new Set<string>();
	const parsed = templates.map((entry): ActivityBark => {
		const item = object(entry);
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

		const templateId = string(item.id, 64, "PACK_TEMPLATE_ID_INVALID");
		if (!ID.test(templateId) || seen.has(templateId))
			throw new ActivityPackError("PACK_TEMPLATE_ID_INVALID");
		seen.add(templateId);

		const family = string(
			item.family,
			32,
			"PACK_FAMILY_INVALID",
		) as BarkFamily;
		if (!FAMILIES.has(family))
			throw new ActivityPackError("PACK_FAMILY_INVALID");

		const tone = item.tone;
		if (tone !== "light" && tone !== "tda")
			throw new ActivityPackError("PACK_TONE_INVALID");

		if (!Array.isArray(item.event_codes) || !item.event_codes.length)
			throw new ActivityPackError("PACK_EVENT_INVALID");
		const eventCodes = item.event_codes.map((event) =>
			string(event, 96, "PACK_EVENT_INVALID"),
		);
		if (eventCodes.some((event) => !ALLOWED_EVENTS.has(event)))
			throw new ActivityPackError("PACK_EVENT_NOT_HUMOROUS");

		const text = string(item.text, 500, "PACK_TEXT_INVALID");
		const implied = placeholders(text);
		let requires: ActivityBark["requires"] =
			implied as ActivityBark["requires"];
		if (item.requires !== undefined) {
			if (!Array.isArray(item.requires))
				throw new ActivityPackError("PACK_REQUIRES_INVALID");
			const declared = item.requires.map((entry) =>
				string(entry, 32, "PACK_REQUIRES_INVALID"),
			);
			if (declared.some((entry) => !ALLOWED_PLACEHOLDERS.has(entry)))
				throw new ActivityPackError("PACK_REQUIRES_INVALID");
			if (implied.some((entry) => !declared.includes(entry)))
				throw new ActivityPackError("PACK_REQUIRES_MISSING");
			requires = declared as ActivityBark["requires"];
		}

		return {
			id: templateId,
			family,
			tone,
			eventCodes,
			requires,
			text,
		};
	});

	const humorLevel = root.humor_level;
	if (humorLevel !== "light" && humorLevel !== "tda")
		throw new ActivityPackError("PACK_HUMOR_LEVEL_INVALID");

	return {
		schemaVersion: ACTIVITY_PACK_SCHEMA,
		id,
		name: string(root.name, 120, "PACK_NAME_INVALID"),
		version: string(root.version, 32, "PACK_VERSION_INVALID"),
		description: optionalString(
			root.description,
			500,
			"PACK_DESCRIPTION_INVALID",
		),
		author: optionalString(root.author, 120, "PACK_AUTHOR_INVALID"),
		language: string(root.language, 16, "PACK_LANGUAGE_INVALID"),
		humorLevel,
		templates: parsed,
	};
}

export function activityPackExample(): string {
	return JSON.stringify(
		{
			schema_version: ACTIVITY_PACK_SCHEMA,
			id: "faysk-chaos-pack",
			name: "Faysk Chaos Pack",
			version: "1.0.0",
			description: "Exemplo local de barks.",
			author: "Faysk",
			language: "pt-BR",
			humor_level: "tda",
			enabled: true,
			templates: [
				{
					id: "faysk-grammar-001",
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
