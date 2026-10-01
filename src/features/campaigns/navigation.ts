import "server-only";

import { serverAuthClient } from "@/features/auth/server";
import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
	type EditAccessContext,
	type EditCapability,
} from "@/features/edit/access/policy";
import {
	LEGACY_CAMPAIGN_NAME,
	LEGACY_CAMPAIGN_PUBLIC_SLUG,
	LEGACY_CAMPAIGN_TECHNICAL_SLUG,
} from "@/features/sessions/model";

const NAVIGATION_TOOL_CAPABILITIES = [
	EDIT_CAPABILITIES.transcriptRead,
	EDIT_CAPABILITIES.localProcess,
	EDIT_CAPABILITIES.worldLayoutEdit,
	EDIT_CAPABILITIES.reviewRead,
	EDIT_CAPABILITIES.permissionsManage,
] as const satisfies readonly EditCapability[];

export type NavigationCampaign = Readonly<{
	technicalSlug: string;
	routeKey: string | null;
	name: string;
	lifecycle: "active" | "archived";
	capabilities: readonly EditCapability[];
}>;

export type NavigationCampaignReadResult = Readonly<{
	mode: "first_class" | "legacy_compatibility" | "unavailable";
	campaigns: readonly NavigationCampaign[];
}>;

function capabilitiesForCampaign(
	context: EditAccessContext,
	technicalSlug: string,
): readonly EditCapability[] {
	return NAVIGATION_TOOL_CAPABILITIES.filter(
		(capability) =>
			authorizeCampaignCapability(context, capability, technicalSlug).ok,
	);
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function parseDirectoryPayload(
	value: unknown,
	context: EditAccessContext,
): readonly NavigationCampaign[] | null {
	if (!Array.isArray(value)) return null;
	const campaigns: NavigationCampaign[] = [];
	for (const raw of value) {
		const row = asRecord(raw);
		if (!row) return null;
		const technicalSlug =
			typeof row.technicalSlug === "string" && row.technicalSlug.length > 0
				? row.technicalSlug
				: null;
		const name =
			typeof row.name === "string" && row.name.length > 0 ? row.name : null;
		const lifecycle =
			row.lifecycle === "active" || row.lifecycle === "archived"
				? row.lifecycle
				: null;
		const routeKey =
			typeof row.routeKey === "string" && row.routeKey.length > 0
				? row.routeKey
				: null;
		if (!technicalSlug || !name || !lifecycle) return null;
		const capabilities = capabilitiesForCampaign(context, technicalSlug);
		if (capabilities.length === 0) continue;
		campaigns.push({
			technicalSlug,
			routeKey,
			name,
			lifecycle,
			capabilities,
		});
	}
	return campaigns;
}

function isMissingDiscoveryRpc(error: {
	code?: string | null;
	message?: string | null;
}): boolean {
	return (
		error.code === "PGRST202" ||
		error.code === "42883" ||
		Boolean(error.message?.includes("campaign_edit_directory"))
	);
}

function legacyCompatibilityCampaign(
	context: EditAccessContext,
): readonly NavigationCampaign[] {
	const capabilities = capabilitiesForCampaign(
		context,
		LEGACY_CAMPAIGN_TECHNICAL_SLUG,
	);
	if (capabilities.length === 0) return [];
	return [
		{
			technicalSlug: LEGACY_CAMPAIGN_TECHNICAL_SLUG,
			routeKey: LEGACY_CAMPAIGN_PUBLIC_SLUG,
			name: LEGACY_CAMPAIGN_NAME,
			lifecycle: "active",
			capabilities,
		},
	];
}

/**
 * Reads the authenticated operational campaign directory prepared by #1134.
 *
 * Before the first-class registry/discovery migrations are activated, the
 * historical campaign remains a deliberate one-campaign compatibility mode.
 * Any other dependency failure fails closed rather than guessing a campaign.
 */
export async function readNavigationCampaigns(
	context: EditAccessContext,
): Promise<NavigationCampaignReadResult> {
	try {
		const client = await serverAuthClient();
		if (!client) return { mode: "unavailable", campaigns: [] };

		const { data, error } = await client.rpc("campaign_edit_directory");
		if (error) {
			if (isMissingDiscoveryRpc(error)) {
				return {
					mode: "legacy_compatibility",
					campaigns: legacyCompatibilityCampaign(context),
				};
			}
			return { mode: "unavailable", campaigns: [] };
		}

		const campaigns = parseDirectoryPayload(data, context);
		return campaigns
			? { mode: "first_class", campaigns }
			: { mode: "unavailable", campaigns: [] };
	} catch {
		return { mode: "unavailable", campaigns: [] };
	}
}
