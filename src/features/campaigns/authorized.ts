import "server-only";

import {
	authorizeCampaignCapability,
	type EditAccessContext,
	type EditCapability,
	type EditGrant,
} from "@/features/edit/access/policy";
import { editDataClient } from "@/integrations/supabase/server";
import {
	isCampaignId,
	isCampaignLifecycle,
	isCampaignVisibility,
	type CampaignLifecycle,
	type CampaignVisibility,
} from "./model";

const PROJECT_SCOPE_ID = "tda";
const SAFE_TECHNICAL_SLUG = /^[A-Za-z0-9_-]{1,128}$/u;

export type AuthorizedCampaign = Readonly<{
	id: string;
	technicalSlug: string;
	name: string;
	lifecycle: CampaignLifecycle;
	visibility: CampaignVisibility;
}>;

export type AuthorizedCampaignsResult =
	| Readonly<{ ok: true; campaigns: readonly AuthorizedCampaign[] }>
	| Readonly<{
			ok: false;
			reason: "profile_unresolved" | "dependency_unavailable";
	  }>;

function grantActive(grant: EditGrant, now: Date): boolean {
	if (grant.status !== "active") return false;
	const startsAt = Date.parse(grant.startsAt);
	if (!Number.isFinite(startsAt) || startsAt > now.getTime()) return false;
	if (!grant.endsAt) return true;
	const endsAt = Date.parse(grant.endsAt);
	return Number.isFinite(endsAt) && endsAt > now.getTime();
}

export function authorizedCampaignGrantScope(
	context: EditAccessContext,
	capability: EditCapability,
	now = new Date(),
): Readonly<{ projectWide: boolean; campaignSlugs: readonly string[] }> {
	const matching = context.grants.filter(
		(grant) => grant.action === capability && grantActive(grant, now),
	);
	const projectWide = matching.some(
		(grant) =>
			grant.scopeType === "project" && grant.scopeId === PROJECT_SCOPE_ID,
	);
	if (projectWide) return { projectWide: true, campaignSlugs: [] };

	const campaignSlugs = [
		...new Set(
			matching
				.filter((grant) => grant.scopeType === "campaign")
				.map((grant) => grant.scopeId)
				.filter((slug) => SAFE_TECHNICAL_SLUG.test(slug)),
		),
	].sort();
	return { projectWide: false, campaignSlugs };
}

function parseCampaign(row: Record<string, unknown>): AuthorizedCampaign | null {
	const id = typeof row.id === "string" && isCampaignId(row.id) ? row.id : null;
	const technicalSlug =
		typeof row.slug === "string" && SAFE_TECHNICAL_SLUG.test(row.slug)
			? row.slug
			: null;
	const name =
		typeof row.name === "string" && row.name.trim().length
			? row.name.trim()
			: null;
	if (
		!id ||
		!technicalSlug ||
		!name ||
		!isCampaignLifecycle(row.lifecycle) ||
		!isCampaignVisibility(row.visibility)
	)
		return null;
	return {
		id,
		technicalSlug,
		name,
		lifecycle: row.lifecycle,
		visibility: row.visibility,
	};
}

export async function readAuthorizedCampaigns(
	context: EditAccessContext,
	capability: EditCapability,
	options: Readonly<{ includeArchived?: boolean }> = {},
): Promise<AuthorizedCampaignsResult> {
	if (!context.profileId) return { ok: false, reason: "profile_unresolved" };

	const scope = authorizedCampaignGrantScope(context, capability);
	if (!scope.projectWide && scope.campaignSlugs.length === 0)
		return { ok: true, campaigns: [] };

	const client = editDataClient();
	if (!client) return { ok: false, reason: "dependency_unavailable" };

	let query = client
		.from("campaigns")
		.select("id,slug,name,lifecycle,visibility")
		.order("name")
		.order("slug");
	if (!options.includeArchived) query = query.eq("lifecycle", "active");
	if (!scope.projectWide) query = query.in("slug", [...scope.campaignSlugs]);

	const { data, error } = await query;
	if (error || !Array.isArray(data))
		return { ok: false, reason: "dependency_unavailable" };

	const campaigns: AuthorizedCampaign[] = [];
	for (const raw of data) {
		if (!raw || typeof raw !== "object" || Array.isArray(raw))
			return { ok: false, reason: "dependency_unavailable" };
		const campaign = parseCampaign(raw as Record<string, unknown>);
		if (!campaign)
			return { ok: false, reason: "dependency_unavailable" };
		if (
			authorizeCampaignCapability(
				context,
				capability,
				campaign.technicalSlug,
			).ok
		)
			campaigns.push(campaign);
	}

	return { ok: true, campaigns };
}
