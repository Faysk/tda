import type { ActivityBark } from "./activity-barks";
import {
	activityPackJsonValue,
	type ActivityPack,
	parseActivityPackJson,
} from "./activity-pack";

export const ACTIVITY_PACKS_CHANGED_EVENT = "tda:activity-packs-changed";
const STORAGE_PREFIX = "tda.processing.activity-packs.v1";

function storageKey(scope: string): string {
	return `${STORAGE_PREFIX}:${encodeURIComponent(scope)}`;
}

function decodeLibrary(raw: string | null): ActivityPack[] {
	if (!raw) return [];
	try {
		const values: unknown = JSON.parse(raw);
		if (!Array.isArray(values)) return [];
		const packs: ActivityPack[] = [];
		for (const value of values) {
			try {
				const parsed = parseActivityPackJson(JSON.stringify(value));
				packs.push(parsed);
			} catch {
				// Corrupt/untrusted browser-local entries are ignored fail-closed.
			}
		}
		return packs;
	} catch {
		return [];
	}
}

export function loadActivityPacks(scope: string | null): ActivityPack[] {
	if (!scope || typeof window === "undefined") return [];
	return decodeLibrary(window.localStorage.getItem(storageKey(scope)));
}

export function saveActivityPacks(
	scope: string,
	packs: readonly ActivityPack[],
): void {
	if (typeof window === "undefined") return;
	const canonical = packs.map((pack) => activityPackJsonValue(pack));
	window.localStorage.setItem(storageKey(scope), JSON.stringify(canonical));
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
