import type { EditAccessContext, EditGrant } from "@/features/edit/access/policy";

export const PROJECT_CAMPAIGNS_MANAGE = "project.campaigns.manage";
const PROJECT_SCOPE_ID = "tda";

function active(grant: EditGrant, now: Date): boolean {
	if (grant.status !== "active") return false;
	const startsAt = Date.parse(grant.startsAt);
	if (!Number.isFinite(startsAt) || startsAt > now.getTime()) return false;
	if (!grant.endsAt) return true;
	const endsAt = Date.parse(grant.endsAt);
	return Number.isFinite(endsAt) && endsAt > now.getTime();
}

export function canManageCampaignRegistry(
	context: EditAccessContext | null,
	now = new Date(),
): boolean {
	if (!context?.profileId) return false;
	return context.grants.some(
		(grant) =>
			grant.action === PROJECT_CAMPAIGNS_MANAGE &&
			grant.scopeType === "project" &&
			grant.scopeId === PROJECT_SCOPE_ID &&
			active(grant, now),
	);
}
