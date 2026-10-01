import "server-only";

import {
	authorizeCampaignCapability,
	type EditAccessContext,
	type EditCapability,
	type EditGrant,
} from "@/features/edit/access/policy";
import { editDataClient } from "@/integrations/supabase/server";

const PROJECT_SCOPE_ID = "tda";
const TECHNICAL_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export type EditSessionCampaignOption = Readonly<{
	id: string;
	technicalSlug: string;
	routeKey: string;
	name: string;
	lifecycle: "active" | "archived";
}>;

export type EligibleEditSessionCampaignsResult =
	| Readonly<{ ok: true; campaigns: readonly EditSessionCampaignOption[] }>
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

function grantScope(
	context: EditAccessContext,
	capability: EditCapability,
	now = new Date(),
) {
	const matching = context.grants.filter(
		(grant) => grant.action === capability && grantActive(grant, now),
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
						.filter((value) => TECHNICAL_SLUG.test(value)),
				),
			].sort();
	return { projectWide, campaignSlugs };
}

function parsedCampaign(
	row: Record<string, unknown>,
): EditSessionCampaignOption | null {
	const id = typeof row.id === "string" ? row.id : "";
	const technicalSlug = typeof row.slug === "string" ? row.slug : "";
	const routeKey = typeof row.public_slug === "string" ? row.public_slug : "";
	const name = typeof row.name === "string" ? row.name.trim() : "";
	const lifecycle =
		row.lifecycle === "active" || row.lifecycle === "archived"
			? row.lifecycle
			: null;
	if (
		!id ||
		!TECHNICAL_SLUG.test(technicalSlug) ||
		!TECHNICAL_SLUG.test(routeKey) ||
		!name ||
		!lifecycle
	) {
		return null;
	}
	return { id, technicalSlug, routeKey, name, lifecycle };
}

export async function readEligibleEditSessionCampaigns(
	context: EditAccessContext,
	capability: EditCapability,
	options: Readonly<{ activeOnly?: boolean }> = {},
): Promise<EligibleEditSessionCampaignsResult> {
	if (!context.profileId) return { ok: false, reason: "profile_unresolved" };

	const scope = grantScope(context, capability);
	if (!scope.projectWide && scope.campaignSlugs.length === 0)
		return { ok: true, campaigns: [] };

	const client = editDataClient();
	if (!client) return { ok: false, reason: "dependency_unavailable" };

	let query = client
		.from("campaigns")
		.select("id,slug,public_slug,name,lifecycle")
		.order("name")
		.order("slug");
	if (options.activeOnly) query = query.eq("lifecycle", "active");
	if (!scope.projectWide) query = query.in("slug", [...scope.campaignSlugs]);

	const { data, error } = await query;
	if (error || !Array.isArray(data))
		return { ok: false, reason: "dependency_unavailable" };

	const campaigns: EditSessionCampaignOption[] = [];
	for (const raw of data) {
		if (!raw || typeof raw !== "object" || Array.isArray(raw))
			return { ok: false, reason: "dependency_unavailable" };
		const campaign = parsedCampaign(raw as Record<string, unknown>);
		if (!campaign) return { ok: false, reason: "dependency_unavailable" };
		if (
			authorizeCampaignCapability(
				context,
				capability,
				campaign.technicalSlug,
			).ok
		) {
			campaigns.push(campaign);
		}
	}
	return { ok: true, campaigns };
}

export function editSessionLibraryHref(campaignSlug: string): string {
	if (!TECHNICAL_SLUG.test(campaignSlug)) throw new Error("Invalid campaign");
	return `/edit/${encodeURIComponent(campaignSlug)}/sessoes`;
}

export function editSessionDetailHref(
	campaignSlug: string,
	sourceSessionId: string,
): string {
	if (!TECHNICAL_SLUG.test(campaignSlug)) throw new Error("Invalid campaign");
	if (!sourceSessionId || sourceSessionId.length > 220)
		throw new Error("Invalid session");
	return `${editSessionLibraryHref(campaignSlug)}/${encodeURIComponent(sourceSessionId)}`;
}
