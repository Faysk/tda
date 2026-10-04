import {
	sessionCampaignMoveOptionsKey,
	type SessionCampaignMoveOptions,
} from "./session-campaign-move-model";

export const SESSION_CAMPAIGN_MOVE_RECOVERY_SCHEMA =
	"tda_session_campaign_move_recovery_v1" as const;
export const SESSION_CAMPAIGN_MOVE_RECOVERY_TTL_MS = 24 * 60 * 60 * 1000;
export const SESSION_CAMPAIGN_MOVE_RECOVERY_MAX_PER_SCOPE = 8;

const STORAGE_PREFIX = "tda.session.campaignMove.v1";
const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SCOPE = /^[a-f0-9]{64}$/u;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

export type SessionCampaignMoveRecoveryIdentity = Readonly<{
	scope: string;
	sessionId: string;
	sourceSessionId: string;
	sourceCampaignSlug: string;
	destinationCampaignSlug: string;
}>;

export type SessionCampaignMoveRecoveryRecord = Readonly<{
	schemaVersion: typeof SESSION_CAMPAIGN_MOVE_RECOVERY_SCHEMA;
	scope: string;
	sessionId: string;
	sourceSessionId: string;
	sourceCampaignSlug: string;
	destinationCampaignSlug: string;
	operationId: string;
	options: SessionCampaignMoveOptions;
	optionsKey: string;
	createdAt: string;
	state: "unresolved";
}>;

function identityKey(identity: SessionCampaignMoveRecoveryIdentity): string {
	return [
		STORAGE_PREFIX,
		identity.scope,
		identity.sessionId.toLowerCase(),
		identity.sourceCampaignSlug,
		identity.destinationCampaignSlug,
	].join(":");
}

function scopePrefix(scope: string): string {
	return `${STORAGE_PREFIX}:${scope}:`;
}

function validIdentity(identity: SessionCampaignMoveRecoveryIdentity): boolean {
	return (
		SCOPE.test(identity.scope) &&
		UUID.test(identity.sessionId) &&
		identity.sourceSessionId.length > 0 &&
		identity.sourceSessionId.length <= 220 &&
		SLUG.test(identity.sourceCampaignSlug) &&
		SLUG.test(identity.destinationCampaignSlug) &&
		identity.sourceCampaignSlug !== identity.destinationCampaignSlug
	);
}

function validOptions(value: unknown): value is SessionCampaignMoveOptions {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const row = value as Record<string, unknown>;
	if (
		Object.keys(row).some(
			(key) =>
				![
					"publishedPolicy",
					"participantEntityPolicy",
					"entityMentionPolicy",
					"canonPolicy",
					"sessionGrantPolicy",
					"legacyCoverPolicy",
				].includes(key),
		)
	)
		return false;
	return (
		(row.publishedPolicy === undefined || row.publishedPolicy === "unpublish") &&
		(row.participantEntityPolicy === undefined ||
			row.participantEntityPolicy === "unlink") &&
		(row.entityMentionPolicy === undefined ||
			row.entityMentionPolicy === "detach_from_session") &&
		(row.canonPolicy === undefined ||
			row.canonPolicy === "detach_entity_links") &&
		(row.sessionGrantPolicy === undefined ||
			row.sessionGrantPolicy === "preserve" ||
			row.sessionGrantPolicy === "revoke") &&
		(row.legacyCoverPolicy === undefined ||
			row.legacyCoverPolicy === "clear_current")
	);
}

function parseRecord(
	raw: string | null,
	now: number,
): SessionCampaignMoveRecoveryRecord | null {
	if (!raw) return null;
	try {
		const value = JSON.parse(raw) as Record<string, unknown>;
		if (
			value.schemaVersion !== SESSION_CAMPAIGN_MOVE_RECOVERY_SCHEMA ||
			value.state !== "unresolved" ||
			typeof value.scope !== "string" ||
			!SCOPE.test(value.scope) ||
			typeof value.sessionId !== "string" ||
			!UUID.test(value.sessionId) ||
			typeof value.sourceSessionId !== "string" ||
			!value.sourceSessionId ||
			value.sourceSessionId.length > 220 ||
			typeof value.sourceCampaignSlug !== "string" ||
			!SLUG.test(value.sourceCampaignSlug) ||
			typeof value.destinationCampaignSlug !== "string" ||
			!SLUG.test(value.destinationCampaignSlug) ||
			value.sourceCampaignSlug === value.destinationCampaignSlug ||
			typeof value.operationId !== "string" ||
			!UUID.test(value.operationId) ||
			!validOptions(value.options) ||
			typeof value.optionsKey !== "string" ||
			value.optionsKey !==
				sessionCampaignMoveOptionsKey(value.options as SessionCampaignMoveOptions) ||
			typeof value.createdAt !== "string"
		)
			return null;
		const createdAt = Date.parse(value.createdAt);
		if (
			!Number.isFinite(createdAt) ||
			createdAt > now + CLOCK_SKEW_MS ||
			now - createdAt > SESSION_CAMPAIGN_MOVE_RECOVERY_TTL_MS
		)
			return null;
		return value as unknown as SessionCampaignMoveRecoveryRecord;
	} catch {
		return null;
	}
}

function matches(
	record: SessionCampaignMoveRecoveryRecord,
	identity: SessionCampaignMoveRecoveryIdentity,
): boolean {
	return (
		record.scope === identity.scope &&
		record.sessionId.toLowerCase() === identity.sessionId.toLowerCase() &&
		record.sourceSessionId === identity.sourceSessionId &&
		record.sourceCampaignSlug === identity.sourceCampaignSlug &&
		record.destinationCampaignSlug === identity.destinationCampaignSlug
	);
}

function ownedKeys(storage: Storage, scope: string): string[] {
	const prefix = scopePrefix(scope);
	const keys: string[] = [];
	for (let index = 0; index < storage.length; index += 1) {
		const key = storage.key(index);
		if (key?.startsWith(prefix)) keys.push(key);
	}
	return keys;
}

function prune(storage: Storage, scope: string, now: number) {
	const valid: Array<{ key: string; createdAt: number }> = [];
	for (const key of ownedKeys(storage, scope)) {
		const record = parseRecord(storage.getItem(key), now);
		if (!record || record.scope !== scope) {
			storage.removeItem(key);
			continue;
		}
		valid.push({ key, createdAt: Date.parse(record.createdAt) });
	}
	valid.sort((left, right) => right.createdAt - left.createdAt);
	for (
		let index = SESSION_CAMPAIGN_MOVE_RECOVERY_MAX_PER_SCOPE - 1;
		index < valid.length;
		index += 1
	) {
		storage.removeItem(valid[index].key);
	}
}

export function saveSessionCampaignMoveRecovery(
	storage: Storage,
	identity: SessionCampaignMoveRecoveryIdentity,
	operationId: string,
	options: SessionCampaignMoveOptions,
	now = Date.now(),
): boolean {
	if (!validIdentity(identity) || !UUID.test(operationId) || !validOptions(options))
		return false;
	prune(storage, identity.scope, now);
	const key = identityKey(identity);
	const existing = parseRecord(storage.getItem(key), now);
	const createdAt =
		existing &&
		matches(existing, identity) &&
		existing.operationId === operationId &&
		existing.optionsKey === sessionCampaignMoveOptionsKey(options)
			? existing.createdAt
			: new Date(now).toISOString();
	const record: SessionCampaignMoveRecoveryRecord = {
		schemaVersion: SESSION_CAMPAIGN_MOVE_RECOVERY_SCHEMA,
		...identity,
		operationId,
		options: { ...options },
		optionsKey: sessionCampaignMoveOptionsKey(options),
		createdAt,
		state: "unresolved",
	};
	storage.setItem(key, JSON.stringify(record));
	return true;
}

export function loadSessionCampaignMoveRecovery(
	storage: Storage,
	identity: SessionCampaignMoveRecoveryIdentity,
	now = Date.now(),
): SessionCampaignMoveRecoveryRecord | null {
	if (!validIdentity(identity)) return null;
	const key = identityKey(identity);
	const record = parseRecord(storage.getItem(key), now);
	if (!record || !matches(record, identity)) {
		storage.removeItem(key);
		return null;
	}
	return record;
}

export function clearSessionCampaignMoveRecovery(
	storage: Storage,
	identity: SessionCampaignMoveRecoveryIdentity,
) {
	if (!validIdentity(identity)) return;
	storage.removeItem(identityKey(identity));
}
