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
const SAFE_ROUTE_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export type AuthorizedCampaign = Readonly<{
	technicalSlug: string;
	routeKey: string;
	name: string;
	lifecycle: CampaignLifecycle;
	capabilities: readonly EditCapability[];
}>;

export type AuthorizedCampaignOption = AuthorizedCampaign;

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

export type CampaignGrantScope = Readonly<{
	projectWide: boolean;
	campaignSlugs: readonly string[];
}>;

export function campaignGrantScopeForCapabilities(
	context: EditAccessContext,
	capabilities: readonly EditCapability[],
	now = new Date(),
): CampaignGrantScope {
	const wanted = new Set<string>(capabilities);
	const matching = context.grants.filter(
		(grant) => wanted.has(grant.action) && grantActive(grant, now),
	);
	const projectWide = matching.some(
		(grant) =>
			grant.scopeType === "project" && grant.scopeId === PROJECT_SCOPE_ID,
	);
	const campaignSlugs = projectWide
		? []
		: [
				...new Set(
					matching
						.filter((grant) => grant.scopeType === "campaign")
						.map((grant) => grant.scopeId)
						.filter((value) => SAFE_TECHNICAL_SLUG.test(value)),
				),
			].sort();
	return { projectWide, campaignSlugs };
}

export function authorizedCampaignGrantScope(
	context: EditAccessContext,
	capability: EditCapability,
	now = new Date(),
): CampaignGrantScope {
	return campaignGrantScopeForCapabilities(context, [capability], now);
}

function text(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0
		? value.trim()
		: null;
}

function parseCampaign(
	row: Record<string, unknown>,
	context: EditAccessContext,
	capabilities: readonly EditCapability[],
): AuthorizedCampaign | null {
	const technicalSlug = text(row.slug);
	const routeKey = text(row.public_slug);
	const name = text(row.name);
	if (
		!technicalSlug ||
		!routeKey ||
		!name ||
		!SAFE_TECHNICAL_SLUG.test(technicalSlug) ||
		!SAFE_ROUTE_KEY.test(routeKey) ||
		!isCampaignLifecycle(row.lifecycle)
	)
		return null;

	const allowed = capabilities.filter(
		(capability) =>
			authorizeCampaignCapability(context, capability, technicalSlug).ok,
	);
	if (allowed.length === 0) return null;
	return {
		technicalSlug,
		routeKey,
		name,
		lifecycle: row.lifecycle,
		capabilities: allowed,
	};
}

export async function readAuthorizedCampaigns(
	context: EditAccessContext,
	capabilityOrCapabilities: EditCapability | readonly EditCapability[],
	options: Readonly<{ includeArchived?: boolean }> = {},
): Promise<AuthorizedCampaignsResult> {
	if (!context.profileId) return { ok: false, reason: "profile_unresolved" };
	const capabilities = Array.isArray(capabilityOrCapabilities)
		? capabilityOrCapabilities
		: [capabilityOrCapabilities];
	if (capabilities.length === 0) return { ok: true, campaigns: [] };

	const scope = campaignGrantScopeForCapabilities(context, capabilities);
	if (!scope.projectWide && scope.campaignSlugs.length === 0)
		return { ok: true, campaigns: [] };

	const client = editDataClient();
	if (!client) return { ok: false, reason: "dependency_unavailable" };

	let query = client
		.from("campaigns")
		.select("slug,public_slug,name,lifecycle")
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
		const campaign = parseCampaign(
			raw as Record<string, unknown>,
			context,
			capabilities,
		);
		if (campaign) campaigns.push(campaign);
	}
	return { ok: true, campaigns };
}

export async function readAuthorizedCampaignsForCapability(
	context: EditAccessContext,
	capability: EditCapability,
	options: Readonly<{ includeArchived?: boolean }> = {},
): Promise<AuthorizedCampaignsResult> {
	return readAuthorizedCampaigns(context, capability, options);
}

export type AuthorizedCampaignResolution =
	| Readonly<{ ok: true; campaign: AuthorizedCampaign }>
	| Readonly<{
			ok: false;
			reason: "profile_unresolved" | "forbidden" | "dependency_unavailable";
	  }>;

export async function resolveAuthorizedCampaign(
	context: EditAccessContext,
	capability: EditCapability,
	technicalSlug: string,
): Promise<AuthorizedCampaignResolution> {
	if (!SAFE_TECHNICAL_SLUG.test(technicalSlug))
		return { ok: false, reason: "forbidden" };
	const result = await readAuthorizedCampaignsForCapability(context, capability, {
		includeArchived: true,
	});
	if (!result.ok) return result;
	const campaign =
		result.campaigns.find((item) => item.technicalSlug === technicalSlug) ?? null;
	return campaign
		? { ok: true, campaign }
		: { ok: false, reason: "forbidden" };
}
