import type { EditAccessContext, EditGrant } from "@/features/edit/access/policy";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";

const PROJECT_SCOPE_ID = "tda";

function active(grant: EditGrant, now: Date): boolean {
	if (grant.status !== "active") return false;
	const startsAt = Date.parse(grant.startsAt);
	if (!Number.isFinite(startsAt) || startsAt > now.getTime()) return false;
	if (!grant.endsAt) return true;
	const endsAt = Date.parse(grant.endsAt);
	return Number.isFinite(endsAt) && endsAt > now.getTime();
}

export type ProcessingCampaignGrantScope = Readonly<{
	projectWide: boolean;
	campaignSlugs: readonly string[];
}>;

export function processingCampaignGrantScope(
	context: EditAccessContext,
	now = new Date(),
): ProcessingCampaignGrantScope {
	const matching = context.grants.filter(
		(grant) =>
			grant.action === EDIT_CAPABILITIES.localProcess && active(grant, now),
	);
	const projectWide = matching.some(
		(grant) =>
			grant.scopeType === "project" && grant.scopeId === PROJECT_SCOPE_ID,
	);
	const campaignSlugs = projectWide
		? []
		: [...new Set(
				matching
					.filter((grant) => grant.scopeType === "campaign")
					.map((grant) => grant.scopeId)
					.filter((value) => /^[A-Za-z0-9_-]{1,128}$/u.test(value)),
			)].sort();
	return { projectWide, campaignSlugs };
}
