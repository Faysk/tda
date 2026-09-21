import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
	type EditAccessContext,
} from "../edit/access/policy";
import type { ImportIdentity } from "./contract";

export type ImportTarget = {
	campaignId: string;
	sessionId: string;
	sourceSystem: string | null;
	sourceSessionId: string | null;
};

export type AuthorizedImportActor = Readonly<{
	authUserId: string;
	profileId: string;
}>;

type ImportLookupResult<T> =
	| Readonly<{ ok: true; value: T }>
	| Readonly<{ ok: false; reason: "not_found" | "dependency_unavailable" }>;

export type ImportAuthorizationQueries = Readonly<{
	physicalAction: () => Promise<
		| Readonly<{ ok: true; exists: boolean }>
		| Readonly<{ ok: false; reason: "dependency_unavailable" }>
	>;
	campaignSlug: (campaignId: string) => Promise<ImportLookupResult<string>>;
	target: (identity: ImportIdentity) => Promise<ImportLookupResult<ImportTarget>>;
}>;

export function authorizeImportCampaignScope(
	context: EditAccessContext,
	campaignSlug: string | null,
	physicalActionExists: boolean,
) {
	if (!physicalActionExists) {
		return { ok: false, reason: "import_capability_undefined" } as const;
	}
	if (!campaignSlug) {
		return { ok: false, reason: "forbidden" } as const;
	}

	const decision = authorizeCampaignCapability(
		context,
		EDIT_CAPABILITIES.transcriptImport,
		campaignSlug,
	);
	if (!decision.ok) {
		return { ok: false, reason: "forbidden" } as const;
	}
	return {
		ok: true,
		actor: { authUserId: context.authUserId, profileId: decision.profileId },
	} as const;
}

export function authorizeImportBoundTarget(
	actor: AuthorizedImportActor,
	identity: ImportIdentity,
	target: ImportTarget | null,
) {
	if (
		!target ||
		target.campaignId !== identity.campaignId ||
		target.sessionId !== identity.sessionId ||
		target.sourceSystem !== "local_companion" ||
		target.sourceSessionId !== identity.sourceSessionId
	) {
		return { ok: false, reason: "not_found" } as const;
	}

	return { ok: true, actor } as const;
}

export async function authorizeImportRequest(
	context: EditAccessContext,
	identity: ImportIdentity,
	queries: ImportAuthorizationQueries,
) {
	const action = await queries.physicalAction();
	if (!action.ok) {
		return { ok: false, reason: "dependency_unavailable" } as const;
	}
	if (!action.exists) {
		return { ok: false, reason: "import_capability_undefined" } as const;
	}

	const campaign = await queries.campaignSlug(identity.campaignId);
	if (!campaign.ok && campaign.reason === "dependency_unavailable") {
		return { ok: false, reason: "dependency_unavailable" } as const;
	}

	// Missing/foreign campaign scope is deliberately opaque until a capability
	// can be proven. In particular, target existence is never consulted here.
	const scope = authorizeImportCampaignScope(
		context,
		campaign.ok ? campaign.value : null,
		true,
	);
	if (!scope.ok) return scope;

	const target = await queries.target(identity);
	if (!target.ok && target.reason === "dependency_unavailable") {
		return { ok: false, reason: "dependency_unavailable" } as const;
	}

	return authorizeImportBoundTarget(
		scope.actor,
		identity,
		target.ok ? target.value : null,
	);
}
