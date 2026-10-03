import {
	EDIT_CAPABILITIES,
	type EditAccessContext,
} from "@/features/edit/access/policy";
import { PROJECT_CAMPAIGNS_MANAGE } from "@/features/campaigns/policy";
import {
	isCampaignRegistrySchemaGap,
	type CampaignRegistrySchemaError,
} from "@/features/campaigns/schema-compatibility";

export type LembraCampaignRegistryError = CampaignRegistrySchemaError;

const PROJECT_SCOPE_ID = "tda";
const DISCOVERY_ACTIONS = new Set<string>([
	...Object.values(EDIT_CAPABILITIES),
	PROJECT_CAMPAIGNS_MANAGE,
]);

function activeGrant(
	grant: EditAccessContext["grants"][number],
	now: Date,
): boolean {
	if (grant.status !== "active") return false;
	const startsAt = Date.parse(grant.startsAt);
	if (!Number.isFinite(startsAt) || startsAt > now.getTime()) return false;
	if (!grant.endsAt) return true;
	const endsAt = Date.parse(grant.endsAt);
	return Number.isFinite(endsAt) && endsAt > now.getTime();
}

export function canDiscoverLembraCampaign(
	context: EditAccessContext,
	technicalSlug: string,
	now = new Date(),
): boolean {
	if (!context.profileId) return false;
	return context.grants.some(
		(grant) =>
			DISCOVERY_ACTIONS.has(grant.action) &&
			activeGrant(grant, now) &&
			((grant.scopeType === "project" && grant.scopeId === PROJECT_SCOPE_ID) ||
				(grant.scopeType === "campaign" && grant.scopeId === technicalSlug)),
	);
}

export function isLembraCampaignRegistryUnavailable(
	error: LembraCampaignRegistryError | null | undefined,
): boolean {
	return isCampaignRegistrySchemaGap(error);
}
