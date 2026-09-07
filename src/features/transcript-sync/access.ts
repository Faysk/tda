import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
	type EditAccessContext,
} from "../edit/access/policy";
import type { ImportIdentity } from "./contract";

export type ImportTarget = {
	campaignId: string;
	campaignSlug: string;
	sessionId: string;
	sourceSystem: string | null;
	sourceSessionId: string | null;
};
export function authorizeImportTarget(
	context: EditAccessContext,
	identity: ImportIdentity,
	target: ImportTarget | null,
	physicalActionExists: boolean,
) {
	if (!physicalActionExists)
		return { ok: false, reason: "import_capability_undefined" } as const;
	if (
		!target ||
		target.campaignId !== identity.campaignId ||
		target.sessionId !== identity.sessionId ||
		target.sourceSystem !== "local_companion" ||
		target.sourceSessionId !== identity.sourceSessionId
	)
		return { ok: false, reason: "not_found" } as const;
	const decision = authorizeCampaignCapability(
		context,
		EDIT_CAPABILITIES.transcriptImport,
		target.campaignSlug,
	);
	if (!decision.ok) return { ok: false, reason: "forbidden" } as const;
	return {
		ok: true,
		actor: { authUserId: context.authUserId, profileId: decision.profileId },
	} as const;
}
