import type { TranscriptionProfileId } from "./protocol";

export const SESSION_INTENT_RECEIPT_SCHEMA =
	"tda_processing_session_intent_receipt_v1" as const;
export const SESSION_INTENT_RECEIPT_TTL_MS = 24 * 60 * 60 * 1000;
export const SESSION_INTENT_RECEIPT_MAX_PER_SCOPE = 8;

const STORAGE_PREFIX = "tda.processing.sessionIntent.v1";
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const SOURCE_ID = /^craig-[0-9a-f]{64}$/u;
const JOB_OR_RUN_ID = /^[A-Za-z0-9._:-]{1,256}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const MAX_SOURCES = 32;
const MAX_CONTEXT_CHARS = 1200;
const MAX_GLOSSARY_CHARS = 1200;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

export type SessionIntentReceiptIdentity = Readonly<{
	profileScopeHash: string;
	campaignId: string;
	sessionId: string;
}>;

export type SessionIntentReceipt = Readonly<{
	schemaVersion: typeof SESSION_INTENT_RECEIPT_SCHEMA;
	profileScope: string;
	campaignId: string;
	sessionId: string;
	requestId: string;
	sourceIds: readonly string[];
	profileId: TranscriptionProfileId;
	context: string;
	glossary: string;
	jobIds: Readonly<Record<string, string>>;
	runIds: Readonly<Record<string, string>>;
	createdAt: string;
	updatedAt: string;
}>;

async function sha256(value: string): Promise<string> {
	const subtle = globalThis.crypto?.subtle;
	if (!subtle) throw new Error("SESSION_INTENT_RECOVERY_CRYPTO_UNAVAILABLE");
	const digest = await subtle.digest("SHA-256", new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

export async function sessionIntentReceiptIdentity(input: Readonly<{
	profileScope: string;
	campaignId: string;
	sessionId: string;
}>): Promise<SessionIntentReceiptIdentity> {
	if (!SAFE_ID.test(input.campaignId) || !SAFE_ID.test(input.sessionId))
		throw new Error("SESSION_INTENT_RECOVERY_ID_INVALID");
	return {
		profileScopeHash: await sha256(input.profileScope),
		campaignId: input.campaignId,
		sessionId: input.sessionId,
	};
}

function storageKey(identity: SessionIntentReceiptIdentity): string {
	return `${STORAGE_PREFIX}:${identity.profileScopeHash}:${identity.campaignId}:${identity.sessionId}`;
}

function scopePrefix(profileScopeHash: string): string {
	return `${STORAGE_PREFIX}:${profileScopeHash}:`;
}

function validSourceMap(
	value: unknown,
	sourceIds: readonly string[],
): value is Record<string, string> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const sourceSet = new Set(sourceIds);
	for (const [sourceId, id] of Object.entries(value)) {
		if (
			!sourceSet.has(sourceId) ||
			typeof id !== "string" ||
			!JOB_OR_RUN_ID.test(id)
		)
			return false;
	}
	return true;
}

function parseReceipt(
	raw: string | null,
	now: number,
): SessionIntentReceipt | null {
	if (!raw) return null;
	try {
		const value = JSON.parse(raw) as Record<string, unknown>;
		if (
			value.schemaVersion !== SESSION_INTENT_RECEIPT_SCHEMA ||
			typeof value.profileScope !== "string" ||
			!SHA256.test(value.profileScope) ||
			typeof value.campaignId !== "string" ||
			!SAFE_ID.test(value.campaignId) ||
			typeof value.sessionId !== "string" ||
			!SAFE_ID.test(value.sessionId) ||
			typeof value.requestId !== "string" ||
			!SAFE_ID.test(value.requestId) ||
			!Array.isArray(value.sourceIds) ||
			value.sourceIds.length < 1 ||
			value.sourceIds.length > MAX_SOURCES ||
			!value.sourceIds.every(
				(sourceId) => typeof sourceId === "string" && SOURCE_ID.test(sourceId),
			) ||
			new Set(value.sourceIds).size !== value.sourceIds.length ||
			typeof value.profileId !== "string" ||
			!SAFE_ID.test(value.profileId) ||
			typeof value.context !== "string" ||
			value.context.length > MAX_CONTEXT_CHARS ||
			typeof value.glossary !== "string" ||
			value.glossary.length > MAX_GLOSSARY_CHARS ||
			!validSourceMap(value.jobIds, value.sourceIds as string[]) ||
			!validSourceMap(value.runIds, value.sourceIds as string[]) ||
			typeof value.createdAt !== "string" ||
			typeof value.updatedAt !== "string"
		)
			return null;
		const createdAtMs = Date.parse(value.createdAt);
		const updatedAtMs = Date.parse(value.updatedAt);
		if (
			!Number.isFinite(createdAtMs) ||
			!Number.isFinite(updatedAtMs) ||
			createdAtMs > now + CLOCK_SKEW_MS ||
			updatedAtMs > now + CLOCK_SKEW_MS ||
			updatedAtMs < createdAtMs ||
			now - updatedAtMs > SESSION_INTENT_RECEIPT_TTL_MS
		)
			return null;
		return value as unknown as SessionIntentReceipt;
	} catch {
		return null;
	}
}

function matchesIdentity(
	receipt: SessionIntentReceipt,
	identity: SessionIntentReceiptIdentity,
): boolean {
	return (
		receipt.profileScope === identity.profileScopeHash &&
		receipt.campaignId === identity.campaignId &&
		receipt.sessionId === identity.sessionId
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
	const valid: Array<{ key: string; updatedAt: number }> = [];
	for (const key of ownedKeys(storage, profileScopeHash)) {
		const receipt = parseReceipt(storage.getItem(key), now);
		if (!receipt || receipt.profileScope !== profileScopeHash) {
			storage.removeItem(key);
			continue;
		}
		valid.push({ key, updatedAt: Date.parse(receipt.updatedAt) });
	}
	valid.sort((left, right) => right.updatedAt - left.updatedAt);
	for (
		let index = SESSION_INTENT_RECEIPT_MAX_PER_SCOPE - 1;
		index < valid.length;
		index += 1
	) {
		storage.removeItem(valid[index].key);
	}
}

export function createSessionIntentReceipt(
	identity: SessionIntentReceiptIdentity,
	input: Readonly<{
		requestId: string;
		sourceIds: readonly string[];
		profileId: TranscriptionProfileId;
		context: string;
		glossary: string;
		jobIds?: Readonly<Record<string, string>>;
		runIds?: Readonly<Record<string, string>>;
	}>,
	now = Date.now(),
): SessionIntentReceipt {
	const value: SessionIntentReceipt = {
		schemaVersion: SESSION_INTENT_RECEIPT_SCHEMA,
		profileScope: identity.profileScopeHash,
		campaignId: identity.campaignId,
		sessionId: identity.sessionId,
		requestId: input.requestId,
		sourceIds: [...input.sourceIds],
		profileId: input.profileId,
		context: input.context,
		glossary: input.glossary,
		jobIds: { ...(input.jobIds ?? {}) },
		runIds: { ...(input.runIds ?? {}) },
		createdAt: new Date(now).toISOString(),
		updatedAt: new Date(now).toISOString(),
	};
	if (!parseReceipt(JSON.stringify(value), now))
		throw new Error("SESSION_INTENT_RECOVERY_RECEIPT_INVALID");
	return value;
}

export function saveSessionIntentReceipt(
	storage: Storage,
	identity: SessionIntentReceiptIdentity,
	receipt: SessionIntentReceipt,
	now = Date.now(),
): boolean {
	if (!matchesIdentity(receipt, identity)) return false;
	const normalized = parseReceipt(
		JSON.stringify({ ...receipt, updatedAt: new Date(now).toISOString() }),
		now,
	);
	if (!normalized) return false;
	pruneScope(storage, identity.profileScopeHash, now);
	storage.setItem(storageKey(identity), JSON.stringify(normalized));
	return true;
}

export function loadSessionIntentReceipt(
	storage: Storage,
	identity: SessionIntentReceiptIdentity,
	now = Date.now(),
): SessionIntentReceipt | null {
	const key = storageKey(identity);
	const receipt = parseReceipt(storage.getItem(key), now);
	if (!receipt || !matchesIdentity(receipt, identity)) {
		storage.removeItem(key);
		return null;
	}
	return receipt;
}

export function updateSessionIntentReceipt(
	receipt: SessionIntentReceipt,
	patch: Readonly<{
		job?: Readonly<{ sourceId: string; jobId: string }>;
		run?: Readonly<{ sourceId: string; runId: string }>;
	}>,
): SessionIntentReceipt {
	const jobIds = { ...receipt.jobIds };
	const runIds = { ...receipt.runIds };
	if (patch.job && receipt.sourceIds.includes(patch.job.sourceId))
		jobIds[patch.job.sourceId] = patch.job.jobId;
	if (patch.run && receipt.sourceIds.includes(patch.run.sourceId))
		runIds[patch.run.sourceId] = patch.run.runId;
	return { ...receipt, jobIds, runIds };
}
