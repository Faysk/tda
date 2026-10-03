const STORAGE_PREFIX = "tda.stale-action-recovery.v1:";
const MAX_RECOVERY_AGE_MS = 24 * 60 * 60 * 1000;

export type StaleActionRecoveryEnvelope<T> = Readonly<{
	version: 1;
	savedAt: number;
	payload: T;
}>;

function errorFragments(value: unknown, depth = 0): string[] {
	if (depth > 2 || value === null || value === undefined) return [];
	if (typeof value === "string") return [value];
	if (typeof value !== "object") return [String(value)];

	const candidate = value as {
		name?: unknown;
		message?: unknown;
		digest?: unknown;
		cause?: unknown;
	};
	const fragments = [candidate.name, candidate.message, candidate.digest].filter(
		(part): part is string => typeof part === "string" && part.length > 0,
	);
	if (candidate.cause !== undefined) {
		fragments.push(...errorFragments(candidate.cause, depth + 1));
	}
	return fragments;
}

export function isStaleServerActionError(error: unknown): boolean {
	const message = errorFragments(error).join(" \n");
	return [
		/UnrecognizedActionError/iu,
		/Server Action (?:was )?not found/iu,
		/Failed to find Server Action/iu,
		/older or newer deployment/iu,
		/action id .+ (?:was )?not found/iu,
	].some((pattern) => pattern.test(message));
}

export function encodeStaleActionRecovery<T>(
	payload: T,
	savedAt = Date.now(),
): string {
	const envelope: StaleActionRecoveryEnvelope<T> = {
		version: 1,
		savedAt,
		payload,
	};
	return JSON.stringify(envelope);
}

export function decodeStaleActionRecovery<T>(
	raw: string | null,
	now = Date.now(),
): T | null {
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as Partial<StaleActionRecoveryEnvelope<T>>;
		if (
			parsed.version !== 1 ||
			typeof parsed.savedAt !== "number" ||
			!("payload" in parsed)
		) {
			return null;
		}
		if (
			parsed.savedAt > now + 60_000 ||
			now - parsed.savedAt > MAX_RECOVERY_AGE_MS
		) {
			return null;
		}
		return parsed.payload as T;
	} catch {
		return null;
	}
}

function storageKey(key: string): string {
	return STORAGE_PREFIX + key;
}

export function persistStaleActionRecovery<T>(key: string, payload: T): void {
	if (typeof window === "undefined") return;
	try {
		window.sessionStorage.setItem(
			storageKey(key),
			encodeStaleActionRecovery(payload),
		);
	} catch {
		// Recovery is best effort. The working copy remains in the current tab.
	}
}

export function readStaleActionRecovery<T>(key: string): T | null {
	if (typeof window === "undefined") return null;
	try {
		const raw = window.sessionStorage.getItem(storageKey(key));
		const payload = decodeStaleActionRecovery<T>(raw);
		if (raw && payload === null) window.sessionStorage.removeItem(storageKey(key));
		return payload;
	} catch {
		return null;
	}
}

export function clearStaleActionRecovery(key: string): void {
	if (typeof window === "undefined") return;
	try {
		window.sessionStorage.removeItem(storageKey(key));
	} catch {
		// Nothing else to do.
	}
}
