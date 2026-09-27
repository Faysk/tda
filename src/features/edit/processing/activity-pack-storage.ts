import {
	ACTIVITY_PACK_STORAGE_EVENT,
	exportActivityPack,
	parseActivityPackJson,
	type ActivityPack,
} from "./activity-pack";

const STORAGE_PREFIX = "tda.processing.activity-packs.v1";

export class ActivityPackStorageError extends Error {
	constructor(public readonly code: string) {
		super(code);
	}
}

export function activityPackStorageKey(input: {
	profileId: string;
	campaignSlug: string;
}): string {
	return [
		STORAGE_PREFIX,
		encodeURIComponent(input.campaignSlug),
		encodeURIComponent(input.profileId),
	].join(":");
}

function storedJson(packs: readonly ActivityPack[]): string {
	return JSON.stringify(packs.map((pack) => JSON.parse(exportActivityPack(pack))));
}

export async function loadActivityPacks(input: {
	profileId: string;
	campaignSlug: string;
}): Promise<ActivityPack[]> {
	if (typeof window === "undefined") return [];
	const raw = window.localStorage.getItem(activityPackStorageKey(input));
	if (!raw) return [];

	let values: unknown;
	try {
		values = JSON.parse(raw);
	} catch {
		throw new ActivityPackStorageError("PACK_LIBRARY_JSON_INVALID");
	}
	if (!Array.isArray(values))
		throw new ActivityPackStorageError("PACK_LIBRARY_INVALID");

	const result: ActivityPack[] = [];
	for (const value of values) {
		result.push(
			await parseActivityPackJson(JSON.stringify(value), {
				preserveEnabled: true,
			}),
		);
	}
	return result;
}

export async function saveActivityPacks(
	input: { profileId: string; campaignSlug: string },
	packs: readonly ActivityPack[],
): Promise<void> {
	if (typeof window === "undefined")
		throw new ActivityPackStorageError("PACK_LIBRARY_BROWSER_REQUIRED");

	// Revalidate the entire candidate library before the single localStorage commit.
	const validated: ActivityPack[] = [];
	for (const pack of packs) {
		validated.push(
			await parseActivityPackJson(exportActivityPack(pack), {
				preserveEnabled: true,
			}),
		);
	}

	const key = activityPackStorageKey(input);
	const payload = storedJson(validated);
	window.localStorage.setItem(key, payload);
	if (window.localStorage.getItem(key) !== payload)
		throw new ActivityPackStorageError("PACK_LIBRARY_READBACK_FAILED");
	window.dispatchEvent(
		new CustomEvent(ACTIVITY_PACK_STORAGE_EVENT, {
			detail: {
				profileId: input.profileId,
				campaignSlug: input.campaignSlug,
			},
		}),
	);
}

export function findPackConflict(
	candidate: ActivityPack,
	existing: readonly ActivityPack[],
):
	| "PACK_ALREADY_IMPORTED"
	| "PACK_VERSION_CONTENT_CONFLICT"
	| "PACK_ID_CONFLICT"
	| null {
	const current = existing.find((pack) => pack.id === candidate.id);
	if (!current) return null;
	if (
		current.version === candidate.version &&
		current.canonicalSha256 === candidate.canonicalSha256
	)
		return "PACK_ALREADY_IMPORTED";
	if (current.version === candidate.version)
		return "PACK_VERSION_CONTENT_CONFLICT";
	return "PACK_ID_CONFLICT";
}

export async function importDisabledActivityPack(
	input: { profileId: string; campaignSlug: string },
	current: readonly ActivityPack[],
	candidate: ActivityPack,
	options: Readonly<{ replace?: boolean }> = {},
): Promise<ActivityPack[]> {
	const conflict = findPackConflict(candidate, current);
	if (conflict === "PACK_ALREADY_IMPORTED") return [...current];
	if (conflict && !options.replace)
		throw new ActivityPackStorageError(conflict);

	const disabled = { ...candidate, enabled: false };
	const next = [
		...current.filter((pack) => pack.id !== candidate.id),
		disabled,
	];
	await saveActivityPacks(input, next);
	return next;
}

export async function setActivityPackEnabled(
	input: { profileId: string; campaignSlug: string },
	current: readonly ActivityPack[],
	packId: string,
	enabled: boolean,
): Promise<ActivityPack[]> {
	if (!current.some((pack) => pack.id === packId))
		throw new ActivityPackStorageError("PACK_NOT_FOUND");
	const next = current.map((pack) =>
		pack.id === packId ? { ...pack, enabled } : pack,
	);
	await saveActivityPacks(input, next);
	return next;
}

export async function removeActivityPack(
	input: { profileId: string; campaignSlug: string },
	current: readonly ActivityPack[],
	packId: string,
): Promise<ActivityPack[]> {
	const next = current.filter((pack) => pack.id !== packId);
	if (next.length === current.length)
		throw new ActivityPackStorageError("PACK_NOT_FOUND");
	await saveActivityPacks(input, next);
	return next;
}
