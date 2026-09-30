import "server-only";
import { editDataClient } from "@/integrations/supabase/server";
import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
	type EditAccessContext,
} from "@/features/edit/access/policy";
import type { ProcessingCampaignOption } from "@/features/edit/processing/campaign-context";
import { processingCampaignGrantScope } from "./processing-policy";

export type EligibleProcessingCampaignsResult =
	| Readonly<{ ok: true; campaigns: readonly ProcessingCampaignOption[] }>
	| Readonly<{
			ok: false;
			reason: "profile_unresolved" | "dependency_unavailable";
	  }>;

function string(value: unknown): string | null {
	return typeof value === "string" && value.length ? value : null;
}

function parseCampaign(
	row: Record<string, unknown>,
): ProcessingCampaignOption | null {
	const technicalSlug = string(row.slug);
	const routeKey = string(row.public_slug);
	const name = string(row.name);
	if (
		!technicalSlug ||
		!routeKey ||
		!name ||
		!/^[A-Za-z0-9_-]{1,128}$/u.test(technicalSlug) ||
		!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(routeKey)
	)
		return null;
	return { technicalSlug, routeKey, name };
}

export async function readEligibleProcessingCampaigns(
	context: EditAccessContext,
): Promise<EligibleProcessingCampaignsResult> {
	if (!context.profileId) return { ok: false, reason: "profile_unresolved" };

	const scope = processingCampaignGrantScope(context);
	if (!scope.projectWide && scope.campaignSlugs.length === 0)
		return { ok: true, campaigns: [] };

	const client = editDataClient();
	if (!client) return { ok: false, reason: "dependency_unavailable" };

	let query = client
		.from("campaigns")
		.select("slug,public_slug,name,lifecycle")
		.eq("lifecycle", "active")
		.order("name")
		.order("slug");
	if (!scope.projectWide) query = query.in("slug", [...scope.campaignSlugs]);

	const { data, error } = await query;
	if (error || !Array.isArray(data))
		return { ok: false, reason: "dependency_unavailable" };

	const campaigns: ProcessingCampaignOption[] = [];
	for (const raw of data) {
		if (!raw || typeof raw !== "object" || Array.isArray(raw))
			return { ok: false, reason: "dependency_unavailable" };
		const parsed = parseCampaign(raw as Record<string, unknown>);
		if (!parsed) return { ok: false, reason: "dependency_unavailable" };
		if (
			authorizeCampaignCapability(
				context,
				EDIT_CAPABILITIES.localProcess,
				parsed.technicalSlug,
			).ok
		)
			campaigns.push(parsed);
	}

	return { ok: true, campaigns };
}
