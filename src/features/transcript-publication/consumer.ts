import {
	confirmedPublicationReceipt,
	preparePublication,
	type PreparedPublication,
	type PublicationFailure,
	type PublicationReceipt,
	type PublicationResult,
} from "./contract";

export type AuthorizedPublicationActor = Readonly<{
	authUserId: string;
	profileId: string;
	campaignId: string;
	/** Null only during the first authorized handoff, before the private session exists. */
	sessionId: string | null;
}>;

export type PublicationDependencies = Readonly<{
	/**
	 * Authorize campaign scope before resolving the physical session target.
	 * Implementations must not consult target/session existence before scope passes.
	 */
	authorize: (
		authUserId: string,
		target: PreparedPublication["target"],
	) => Promise<
		| { ok: true; actor: AuthorizedPublicationActor }
		| { ok: false; reason: PublicationFailure }
	>;
	commit: (
		actor: AuthorizedPublicationActor,
		input: PreparedPublication,
	) => Promise<PublicationResult>;
	lookup: (
		actor: AuthorizedPublicationActor,
		input: PreparedPublication,
	) => Promise<PublicationResult>;
}>;

function expectedWithResolvedTarget(
	actor: AuthorizedPublicationActor,
	input: PreparedPublication,
	receipt: PublicationReceipt,
) {
	// A first handoff has no session UUID before the server-only atomic boundary
	// creates/resolves it. The repository verifies that the returned UUID belongs
	// to the exact authorized campaign + sourceSessionId before this receipt is
	// exposed here.
	const sessionId = actor.sessionId ?? receipt.sessionId;
	return {
		...input,
		campaignId: actor.campaignId,
		sessionId,
	};
}

export async function publishTranscriptRevision(
	raw: string,
	authUserId: string | null,
	deps: PublicationDependencies,
): Promise<PublicationResult> {
	if (!authUserId) return { ok: false, reason: "unauthenticated" };
	const parsed = preparePublication(raw);
	if (!parsed.ok) return parsed;
	try {
		const access = await deps.authorize(authUserId, parsed.value.target);
		if (!access.ok) return access;
		if (access.actor.authUserId !== authUserId || (parsed.value.expectedActorProfileId !== undefined && parsed.value.expectedActorProfileId !== access.actor.profileId))
			return { ok: false, reason: "forbidden" };
		const result = await deps.commit(access.actor, parsed.value);
		if (!result.ok) return result;
		return confirmedPublicationReceipt(
			result.receipt,
			expectedWithResolvedTarget(access.actor, parsed.value, result.receipt),
		)
			? result
			: { ok: false, reason: "dependency_unavailable" };
	} catch {
		return { ok: false, reason: "dependency_unavailable" };
	}
}

export async function readPublicationReceipt(
	raw: string,
	authUserId: string | null,
	deps: PublicationDependencies,
): Promise<PublicationResult> {
	if (!authUserId) return { ok: false, reason: "unauthenticated" };
	const parsed = preparePublication(raw);
	if (!parsed.ok) return parsed;
	try {
		const access = await deps.authorize(authUserId, parsed.value.target);
		if (!access.ok) return access;
		if (access.actor.authUserId !== authUserId || (parsed.value.expectedActorProfileId !== undefined && parsed.value.expectedActorProfileId !== access.actor.profileId))
			return { ok: false, reason: "forbidden" };
		const result = await deps.lookup(access.actor, parsed.value);
		if (!result.ok) return result;
		return confirmedPublicationReceipt(
			result.receipt,
			expectedWithResolvedTarget(access.actor, parsed.value),
		)
			? result
			: { ok: false, reason: "dependency_unavailable" };
	} catch {
		return { ok: false, reason: "dependency_unavailable" };
	}
}

export const deniedPublicationDependencies: PublicationDependencies = {
	authorize: async () => ({
		ok: false,
		reason: "publish_capability_undefined",
	}),
	commit: async () => ({ ok: false, reason: "dependency_unavailable" }),
	lookup: async () => ({ ok: false, reason: "dependency_unavailable" }),
};

export type { PublicationReceipt };
