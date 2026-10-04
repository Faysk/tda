import {
	type SessionCampaignMoveRecoveryIntent,
	validSessionCampaignMoveRecoveryIntent,
} from "./session-campaign-move-model";

const STORAGE_PREFIX = "tda.session-campaign-move.v2:";
const MAX_RECOVERY_AGE_MS = 24 * 60 * 60 * 1000;

type Envelope = Readonly<{
	version: 1;
	savedAt: number;
	intent: SessionCampaignMoveRecoveryIntent;
}>;

export function encodeSessionCampaignMoveRecovery(
	intent: SessionCampaignMoveRecoveryIntent,
	savedAt = Date.now(),
): string {
	return JSON.stringify({ version: 1, savedAt, intent } satisfies Envelope);
}

export function decodeSessionCampaignMoveRecovery(
	raw: string | null,
	now = Date.now(),
): SessionCampaignMoveRecoveryIntent | null {
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as Partial<Envelope>;
		if (
			parsed.version !== 1 ||
			typeof parsed.savedAt !== "number" ||
			parsed.savedAt > now + 60_000 ||
			now - parsed.savedAt > MAX_RECOVERY_AGE_MS ||
			!validSessionCampaignMoveRecoveryIntent(parsed.intent)
		) {
			return null;
		}
		return parsed.intent;
	} catch {
		return null;
	}
}

function key(sessionId: string): string {
	return STORAGE_PREFIX + sessionId;
}

export function persistSessionCampaignMoveRecovery(
	intent: SessionCampaignMoveRecoveryIntent,
): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(
			key(intent.sessionId),
			encodeSessionCampaignMoveRecovery(intent),
		);
	} catch {
		// Recovery is best effort; the database operation remains idempotent.
	}
}

export function readSessionCampaignMoveRecovery(
	sessionId: string,
): SessionCampaignMoveRecoveryIntent | null {
	if (typeof window === "undefined") return null;
	try {
		const storageKey = key(sessionId);
		const raw = window.localStorage.getItem(storageKey);
		const intent = decodeSessionCampaignMoveRecovery(raw);
		if (raw && !intent) window.localStorage.removeItem(storageKey);
		return intent;
	} catch {
		return null;
	}
}

export function clearSessionCampaignMoveRecovery(sessionId: string): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.removeItem(key(sessionId));
	} catch {
		// Nothing else to do.
	}
}
