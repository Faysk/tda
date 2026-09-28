export const SUBMISSION_RECOVERY_SCHEMA_VERSION =
	"tda_processing_pending_submission_v1" as const;
export const SUBMISSION_RECOVERY_TTL_MS = 24 * 60 * 60 * 1000;
export const SUBMISSION_RECOVERY_MAX_PER_SCOPE = 8;

const STORAGE_PREFIX = "tda.processing.pendingSubmission.v1";
const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const SOURCE_ID = /^craig-[0-9a-f]{64}$/u;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{1,128}$/u;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

export type PendingSubmissionRecoveryIdentity = Readonly<{
	profileScopeHash: string;
	campaignId: string;
	sessionId: string;
	sourceId: string;
	profileId: string;
	requestSignatureHash: string;
}>;

export type PendingSubmissionRecoveryRecord = Readonly<{
	schemaVersion: typeof SUBMISSION_RECOVERY_SCHEMA_VERSION;
	profileScope: string;
	campaignId: string;
	sessionId: string;
	sourceId: string;
	profileId: string;
	requestSignatureHash: string;
	idempotencyKey: string;
	createdAt: string;
	state: "unresolved";
}>;

function storageKey(identity: PendingSubmissionRecoveryIdentity): string {
	return `${STORAGE_PREFIX}:${identity.profileScopeHash}:${identity.requestSignatureHash}`;
}

function scopePrefix(profileScopeHash: string): string {
	return `${STORAGE_PREFIX}:${profileScopeHash}:`;
}

async function sha256(value: string): Promise<string> {
	const subtle = globalThis.crypto?.subtle;
	if (!subtle) throw new Error("SUBMISSION_RECOVERY_CRYPTO_UNAVAILABLE");
	const digest = await subtle.digest("SHA-256", new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

export async function pendingSubmissionRecoveryIdentity(input: Readonly<{
	profileScope: string;
	campaignId: string;
	sessionId: string;
	sourceId: string;
	profileId: string;
	requestSignature: string;
}>): Promise<PendingSubmissionRecoveryIdentity> {
	const [profileScopeHash, requestSignatureHash] = await Promise.all([
		sha256(input.profileScope),
		sha256(input.requestSignature),
	]);
	return {
		profileScopeHash,
		campaignId: input.campaignId,
		sessionId: input.sessionId,
		sourceId: input.sourceId,
		profileId: input.profileId,
		requestSignatureHash,
	};
}

function parseRecord(
	raw: string | null,
	now: number,
): PendingSubmissionRecoveryRecord | null {
	if (!raw) return null;
	try {
		const value = JSON.parse(raw) as Record<string, unknown>;
		if (
			value.schemaVersion !== SUBMISSION_RECOVERY_SCHEMA_VERSION ||
			value.state !== "unresolved" ||
			typeof value.profileScope !== "string" ||
			!SHA256.test(value.profileScope) ||
			typeof value.requestSignatureHash !== "string" ||
			!SHA256.test(value.requestSignatureHash) ||
			typeof value.campaignId !== "string" ||
			!SAFE_ID.test(value.campaignId) ||
			typeof value.sessionId !== "string" ||
			!SAFE_ID.test(value.sessionId) ||
			typeof value.sourceId !== "string" ||
			!SOURCE_ID.test(value.sourceId) ||
			typeof value.profileId !== "string" ||
			!SAFE_ID.test(value.profileId) ||
			typeof value.idempotencyKey !== "string" ||
			!IDEMPOTENCY_KEY.test(value.idempotencyKey) ||
			typeof value.createdAt !== "string"
		) {
			return null;
		}
		const createdAtMs = Date.parse(value.createdAt);
		if (
			!Number.isFinite(createdAtMs) ||
			createdAtMs > now + CLOCK_SKEW_MS ||
			now - createdAtMs > SUBMISSION_RECOVERY_TTL_MS
		) {
			return null;
		}
		return value as PendingSubmissionRecoveryRecord;
	} catch {
		return null;
	}
}

function matchesIdentity(
	record: PendingSubmissionRecoveryRecord,
	identity: PendingSubmissionRecoveryIdentity,
): boolean {
	return (
		record.profileScope === identity.profileScopeHash &&
		record.campaignId === identity.campaignId &&
		record.sessionId === identity.sessionId &&
		record.sourceId === identity.sourceId &&
		record.profileId === identity.profileId &&
		record.requestSignatureHash === identity.requestSignatureHash
	);
}

function ownedKeys(storage: Storage, profileScopeHash: string): string[] {
	const prefix = scopePrefix(profileScopeHash);
	const keys: string[] = [];
	for (let index = 0; index < storage.length; index += 1) {
		const key = storage.key(index);
		if (key?.startsWith(prefix)) keys.push(key);
	}
	return keys;
}

function pruneScope(storage: Storage, profileScopeHash: string, now: number) {
	const valid: Array<{ key: string; createdAtMs: number }> = [];
	for (const key of ownedKeys(storage, profileScopeHash)) {
		const record = parseRecord(storage.getItem(key), now);
		if (!record || record.profileScope !== profileScopeHash) {
			storage.removeItem(key);
			continue;
		}
		valid.push({ key, createdAtMs: Date.parse(record.createdAt) });
	}
	valid.sort((left, right) => right.createdAtMs - left.createdAtMs);
	for (
		let index = SUBMISSION_RECOVERY_MAX_PER_SCOPE - 1;
		index < valid.length;
		index += 1
	) {
		storage.removeItem(valid[index].key);
	}
}

export function loadPendingSubmission(
	storage: Storage,
	identity: PendingSubmissionRecoveryIdentity,
	now = Date.now(),
): PendingSubmissionRecoveryRecord | null {
	const key = storageKey(identity);
	const record = parseRecord(storage.getItem(key), now);
	if (!record || !matchesIdentity(record, identity)) {
		storage.removeItem(key);
		return null;
	}
	return record;
}

export function savePendingSubmission(
	storage: Storage,
	identity: PendingSubmissionRecoveryIdentity,
	idempotencyKey: string,
	now = Date.now(),
): boolean {
	if (!IDEMPOTENCY_KEY.test(idempotencyKey)) return false;
	const key = storageKey(identity);
	const existing = parseRecord(storage.getItem(key), now);
	const createdAt =
		existing &&
		matchesIdentity(existing, identity) &&
		existing.idempotencyKey === idempotencyKey
			? existing.createdAt
			: new Date(now).toISOString();
	pruneScope(storage, identity.profileScopeHash, now);
	const record: PendingSubmissionRecoveryRecord = {
		schemaVersion: SUBMISSION_RECOVERY_SCHEMA_VERSION,
		profileScope: identity.profileScopeHash,
		campaignId: identity.campaignId,
		sessionId: identity.sessionId,
		sourceId: identity.sourceId,
		profileId: identity.profileId,
		requestSignatureHash: identity.requestSignatureHash,
		idempotencyKey,
		createdAt,
		state: "unresolved",
	};
	storage.setItem(key, JSON.stringify(record));
	return true;
}

export function clearPendingSubmission(
	storage: Storage,
	identity: PendingSubmissionRecoveryIdentity,
) {
	storage.removeItem(storageKey(identity));
}
