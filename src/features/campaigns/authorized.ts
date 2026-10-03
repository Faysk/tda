import "server-only";

import {
	authorizeCampaignCapability,
	type EditAccessContext,
	type EditCapability,
	type EditGrant,
} from "@/features/edit/access/policy";
import { editDataClient } from "@/integrations/supabase/server";
import {
	isCampaignLifecycle,
	type CampaignLifecycle,
} from "./model";

const PROJECT_SCOPE_ID = "tda";
const SAFE_TECHNICAL_SLUG = /^[A-Za-z0-9_-]{1,128}$/u;

export type AuthorizedCampaign = Readonly<{
	technicalSlug: string;
	name: string;
	lifecycle: CampaignLifecycle;
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

export function authorizedCampaignGrantScopeForCapabilities(
	context: EditAccessContext,
	capabilities: readonly EditCapability[],
	now = new Date(),
): Readonly<{ projectWide: boolean; campaignSlugs: readonly string[] }> {
	const scopes = capabilities.map((capability) =>
		authorizedCampaignGrantScope(context, capability, now),
	);
	if (scopes.some((scope) => scope.projectWide))
		return { projectWide: true, campaignSlugs: [] };
	return {
		projectWide: false,
		campaignSlugs: [
			...new Set(scopes.flatMap((scope) => scope.campaignSlugs)),
		].sort(),
	};
}

function parseCampaign(row: Record<string, unknown>): AuthorizedCampaign | null {
	const technicalSlug =
		typeof row.slug === "string" && SAFE_TECHNICAL_SLUG.test(row.slug)
			? row.slug
			: null;
	const name =
		typeof row.name === "string" && row.name.trim().length
			? row.name.trim()
			: null;
	if (
		!technicalSlug ||
		!name ||
		!isCampaignLifecycle(row.lifecycle)
	)
		return null;
	return {
		technicalSlug,
		name,
		lifecycle: row.lifecycle,
	};
}

export async function readAuthorizedCampaignsForCapabilities(
	context: EditAccessContext,
	capabilities: readonly EditCapability[],
	options: Readonly<{ includeArchived?: boolean }> = {},
): Promise<AuthorizedCampaignsResult> {
	if (!context.profileId) return { ok: false, reason: "profile_unresolved" };

	const scope = authorizedCampaignGrantScopeForCapabilities(
		context,
		capabilities,
	);
	if (!scope.projectWide && scope.campaignSlugs.length === 0)
		return { ok: true, campaigns: [] };

	const client = editDataClient();
	if (!client) return { ok: false, reason: "dependency_unavailable" };

	let query = client
		.from("campaigns")
		.select("slug,name,lifecycle")
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
			capabilities.some(
				(capability) =>
					authorizeCampaignCapability(
						context,
						capability,
						campaign.technicalSlug,
					).ok,
			)
		)
			campaigns.push(campaign);
	}

	return { ok: true, campaigns };
}

export async function readAuthorizedCampaigns(
	context: EditAccessContext,
	capability: EditCapability,
	options: Readonly<{ includeArchived?: boolean }> = {},
): Promise<AuthorizedCampaignsResult> {
	return readAuthorizedCampaignsForCapabilities(
		context,
		[capability],
		options,
	);
}
