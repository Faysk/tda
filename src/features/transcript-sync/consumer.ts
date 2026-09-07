import {
	confirmedReceipt,
	type ImportFailure,
	type ImportIdentity,
	type ImportReceipt,
	type ImportResult,
	type PreparedImport,
} from "./contract";
import { prepareImport } from "./validate";

export type AuthorizedOperator = Readonly<{
	authUserId: string;
	profileId: string;
}>;
export type ImportDependencies = Readonly<{
	/** Must resolve the operator and physical import capability for this exact session. */
	authorize: (
		authUserId: string,
		identity: ImportIdentity,
	) => Promise<
		| { ok: true; actor: AuthorizedOperator }
		| { ok: false; reason: ImportFailure }
	>;
	/** Must atomically validate ownership, insert all segments and commit the durable receipt. */
	commit: (
		actor: AuthorizedOperator,
		input: PreparedImport,
	) => Promise<ImportResult>;
	lookup: (
		actor: AuthorizedOperator,
		identity: ImportIdentity,
	) => Promise<ImportResult>;
}>;

export async function consumeTranscript(
	raw: string,
	authUserId: string | null,
	deps: ImportDependencies,
): Promise<ImportResult> {
	if (!authUserId) return { ok: false, reason: "unauthenticated" };
	const parsed = prepareImport(raw);
	if (!parsed.ok) return parsed;
	try {
		const access = await deps.authorize(authUserId, parsed.value);
		if (!access.ok) return access;
		if (access.actor.authUserId !== authUserId)
			return { ok: false, reason: "forbidden" };
		const saved = await deps.commit(access.actor, parsed.value);
		if (!saved.ok) return saved;
		return confirmedReceipt(
			saved.receipt,
			parsed.value,
			parsed.value.segments.length,
		)
			? saved
			: { ok: false, reason: "dependency_unavailable" };
	} catch {
		return { ok: false, reason: "dependency_unavailable" };
	}
}

export async function queryReceipt(
	identity: ImportIdentity,
	segmentCount: number,
	authUserId: string | null,
	deps: ImportDependencies,
): Promise<ImportResult> {
	if (!authUserId) return { ok: false, reason: "unauthenticated" };
	try {
		const access = await deps.authorize(authUserId, identity);
		if (!access.ok) return access;
		if (access.actor.authUserId !== authUserId)
			return { ok: false, reason: "forbidden" };
		const saved = await deps.lookup(access.actor, identity);
		return !saved.ok || confirmedReceipt(saved.receipt, identity, segmentCount)
			? saved
			: { ok: false, reason: "dependency_unavailable" };
	} catch {
		return { ok: false, reason: "dependency_unavailable" };
	}
}

// No permission alias, inferred grant, environment override, or unsafe fallback.
// Replace only after the physical action/scope and atomic database contract are agreed and verified.
export const deniedImportDependencies: ImportDependencies = {
	authorize: async () => ({ ok: false, reason: "import_capability_undefined" }),
	commit: async () => ({ ok: false, reason: "dependency_unavailable" }),
	lookup: async () => ({ ok: false, reason: "dependency_unavailable" }),
};

export type { ImportReceipt };
