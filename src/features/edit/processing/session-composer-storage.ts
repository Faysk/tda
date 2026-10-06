import {
	clearPendingSubmission,
	loadPendingSubmission,
	pendingSubmissionRecoveryIdentity,
	savePendingSubmission,
	type PendingSubmissionRecoveryIdentity,
} from "./submission-recovery";

const SESSION_COMPOSER_RECOVERY_PREFIX =
	"tda.processing.session-composer.recovery.v2";

export function sessionComposerRecoveryKey(campaignId: string): string {
	if (!/^[A-Za-z0-9_-]{1,128}$/u.test(campaignId))
		throw new Error("Invalid campaign id for session composer recovery");
	return `${SESSION_COMPOSER_RECOVERY_PREFIX}:${campaignId}`;
}
const SESSION_COMPOSER_LAST_SESSION_PREFIX =
	"tda.processing.session-composer.last-session.v2";

export function sessionComposerLastSessionKey(campaignId: string): string {
	if (!/^[A-Za-z0-9_-]{1,128}$/u.test(campaignId))
		throw new Error("Invalid campaign id for session composer storage");
	return `${SESSION_COMPOSER_LAST_SESSION_PREFIX}:${campaignId}`;
}

const LEGACY_SINGLE_CAMPAIGN_ID = "yuhara-main";
const LEGACY_SESSION_COMPOSER_RECOVERY_KEY =
	"tda.processing.session-composer.v1";
const LEGACY_SESSION_COMPOSER_LAST_SESSION_KEY =
	"tda.processing.session-composer.last-session.v1";
const SAFE_SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/u;

function readScopedPointer(
	storage: Storage,
	campaignId: string,
	key: string,
	legacyKey: string,
): string | null {
	const current = storage.getItem(key);
	if (current && SAFE_SESSION_ID.test(current)) return current;
	if (campaignId !== LEGACY_SINGLE_CAMPAIGN_ID) return null;

	const legacy = storage.getItem(legacyKey);
	if (!legacy || !SAFE_SESSION_ID.test(legacy)) return null;
	try {
		storage.setItem(key, legacy);
		storage.removeItem(legacyKey);
	} catch {
		// Migration is best-effort. The legacy pointer remains readable for this load.
	}
	return legacy;
}

export function readSessionComposerRecoveryPointer(
	storage: Storage,
	campaignId: string,
): string | null {
	return readScopedPointer(
		storage,
		campaignId,
		sessionComposerRecoveryKey(campaignId),
		LEGACY_SESSION_COMPOSER_RECOVERY_KEY,
	);
}

export function readSessionComposerLastSessionPointer(
	storage: Storage,
	campaignId: string,
): string | null {
	return readScopedPointer(
		storage,
		campaignId,
		sessionComposerLastSessionKey(campaignId),
		LEGACY_SESSION_COMPOSER_LAST_SESSION_KEY,
	);
}

export function saveSessionComposerPointers(
	storage: Storage,
	campaignId: string,
	sessionId: string,
): void {
	if (!SAFE_SESSION_ID.test(sessionId))
		throw new Error("Invalid session id for session composer storage");
	storage.setItem(sessionComposerRecoveryKey(campaignId), sessionId);
	storage.setItem(sessionComposerLastSessionKey(campaignId), sessionId);
}

export function clearSessionComposerRecoveryPointer(
	storage: Storage,
	campaignId: string,
): void {
	storage.removeItem(sessionComposerRecoveryKey(campaignId));
	if (campaignId === LEGACY_SINGLE_CAMPAIGN_ID)
		storage.removeItem(LEGACY_SESSION_COMPOSER_RECOVERY_KEY);
}
export function clearSessionComposerPointers(
	storage: Storage,
	campaignId: string,
): void {
	clearSessionComposerRecoveryPointer(storage, campaignId);
	storage.removeItem(sessionComposerLastSessionKey(campaignId));
	if (campaignId === LEGACY_SINGLE_CAMPAIGN_ID)
		storage.removeItem(LEGACY_SESSION_COMPOSER_LAST_SESSION_KEY);
}
export const SESSION_COMPOSER_CHANGE_EVENT =
	"tda-session-composer-change";


export type SessionComposerPendingSubmission = Readonly<{
	key: string;
	signature: string;
	recoveryIdentity: PendingSubmissionRecoveryIdentity | null;
	recoveredFromStorage: boolean;
}>;

export async function resolveSessionComposerPendingSubmission(input: Readonly<{
	storage: Storage;
	recoveryScope: string | null;
	campaignId: string;
	sessionId: string;
	sourceId: string;
	profileId: string;
	requestSignature: string;
	existing?: SessionComposerPendingSubmission | null;
	createKey?: () => string;
}>): Promise<SessionComposerPendingSubmission> {
	if (input.existing?.signature === input.requestSignature) return input.existing;

	let recoveryIdentity: PendingSubmissionRecoveryIdentity | null = null;
	let recoveredKey: string | null = null;
	if (input.recoveryScope) {
		try {
			recoveryIdentity = await pendingSubmissionRecoveryIdentity({
				profileScope: input.recoveryScope,
				campaignId: input.campaignId,
				sessionId: input.sessionId,
				sourceId: input.sourceId,
				profileId: input.profileId,
				requestSignature: input.requestSignature,
			});
			recoveredKey =
				loadPendingSubmission(input.storage, recoveryIdentity)?.idempotencyKey ?? null;
		} catch {
			recoveryIdentity = null;
			recoveredKey = null;
		}
	}

	const value: SessionComposerPendingSubmission = {
		key: recoveredKey ?? (input.createKey ?? (() => crypto.randomUUID()))(),
		signature: input.requestSignature,
		recoveryIdentity,
		recoveredFromStorage: recoveredKey !== null,
	};
	if (recoveryIdentity) {
		try {
			savePendingSubmission(input.storage, recoveryIdentity, value.key);
		} catch {
			// Browser persistence is recovery-only; the in-memory key remains authoritative.
		}
	}
	return value;
}

export function confirmSessionComposerPendingSubmission(
	storage: Storage,
	value: SessionComposerPendingSubmission,
) {
	if (!value.recoveryIdentity) return;
	try {
		clearPendingSubmission(storage, value.recoveryIdentity);
	} catch {
		// A confirmed Agent response is authoritative even if browser cleanup fails.
	}
}
