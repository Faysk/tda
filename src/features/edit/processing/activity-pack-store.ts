import type { ActivityBark } from "./activity-barks";
import {
	activityPackJsonValue,
	type ActivityPack,
	parseActivityPackJson,
} from "./activity-pack";

export const ACTIVITY_PACKS_CHANGED_EVENT = "tda:activity-packs-changed";
const STORAGE_PREFIX = "tda.processing.activity-packs.v1";
const LEGACY_STORAGE_KEY = STORAGE_PREFIX;

function storageKey(scope: string): string {
	return `${STORAGE_PREFIX}:${encodeURIComponent(scope)}`;
}

function legacyPackJson(value: unknown): string | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const stored = value as Partial<ActivityPack>;
	if (stored.schemaVersion !== "tda_activity_pack_v1" || !stored.id) return null;
	return JSON.stringify({
		schema_version: stored.schemaVersion,
		id: stored.id,
		name: stored.name,
		version: stored.version,
		description: stored.description,
		author: stored.author,
		language: stored.language,
		humor_level: stored.humorLevel,
		enabled: stored.enabled === true,
		templates: Array.isArray(stored.templates)
			? stored.templates.map((item) => ({
					id: item.id,
					family: item.family,
					tone: item.tone,
					event_codes: item.eventCodes,
					requires: item.requires,
					text: item.text,
				}))
			: [],
	});
}

function decodeLibrary(raw: string | null): ActivityPack[] {
	if (!raw) return [];
	try {
		const values: unknown = JSON.parse(raw);
		if (!Array.isArray(values)) return [];
		const packs: ActivityPack[] = [];
		for (const value of values) {
			try {
				const canonical =
					value &&
					typeof value === "object" &&
					!Array.isArray(value) &&
					"schema_version" in value
						? JSON.stringify(value)
						: legacyPackJson(value);
				if (!canonical) continue;
				packs.push(parseActivityPackJson(canonical));
			} catch {
				// One corrupt local entry must not disable the rest of the library.
			}
		}
		return packs;
	} catch {
		return [];
	}
}

export function loadActivityPacks(scope: string | null): ActivityPack[] {
	if (!scope || typeof window === "undefined") return [];
	const scoped = window.localStorage.getItem(storageKey(scope));
	if (scoped !== null) return decodeLibrary(scoped);

	const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
	if (legacy === null) return [];
	const migrated = decodeLibrary(legacy).map((pack) => ({ ...pack, enabled: false }));
	saveActivityPacks(scope, migrated);
	return migrated;
}

export function saveActivityPacks(
	scope: string,
	packs: readonly ActivityPack[],
): void {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(
		storageKey(scope),
		JSON.stringify(packs.map((pack) => activityPackJsonValue(pack))),
	);
	window.dispatchEvent(
		new CustomEvent(ACTIVITY_PACKS_CHANGED_EVENT, { detail: { scope } }),
	);
}

export function enabledCustomActivityBarks(
	scope: string | null,
): readonly ActivityBark[] {
	return loadActivityPacks(scope)
		.filter((pack) => pack.enabled)
		.flatMap((pack) => pack.templates);
}

export function subscribeActivityPacks(
	scope: string | null,
	callback: () => void,
): () => void {
	if (!scope || typeof window === "undefined") return () => undefined;
	const key = storageKey(scope);
	const onCustom = (event: Event) => {
		const detail = (event as CustomEvent<{ scope?: string }>).detail;
		if (!detail?.scope || detail.scope === scope) callback();
	};
	const onStorage = (event: StorageEvent) => {
		if (event.key === key) callback();
	};
	window.addEventListener(ACTIVITY_PACKS_CHANGED_EVENT, onCustom);
	window.addEventListener("storage", onStorage);
	return () => {
		window.removeEventListener(ACTIVITY_PACKS_CHANGED_EVENT, onCustom);
		window.removeEventListener("storage", onStorage);
	};
}
