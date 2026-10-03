import { notFound } from "next/navigation";
import {
	ACCOUNT_CAPABILITY_GROUPS,
	effectiveAccountCampaignCapabilityGroups,
} from "@/features/auth/account-access";
import type { AccountCampaignAccessResult } from "@/features/auth/account-campaigns";
import {
	AccountOverview,
	type AccountOverviewAccess,
} from "@/features/auth/account-overview";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";

export const dynamic = "force-dynamic";

const allCampaignGrants = Object.values(EDIT_CAPABILITIES).map((action) => ({
	action,
	scopeType: "campaign",
	scopeId: "yuhara-main",
	status: "active",
	startsAt: "2026-01-01T00:00:00Z",
	endsAt: null,
}));

const allProjectGrants = Object.values(EDIT_CAPABILITIES).map((action) => ({
	action,
	scopeType: "project",
	scopeId: "tda",
	status: "active",
	startsAt: "2026-01-01T00:00:00Z",
	endsAt: null,
}));

function syntheticAccess(state: string | undefined): AccountOverviewAccess {
	if (state === "anonymous") {
		return { state: "anonymous", context: null, identity: null };
	}
	if (state === "unavailable") {
		return { state: "unavailable", context: null, identity: null };
	}
	if (state === "unlinked") {
		return {
			state: "authenticated_unlinked",
			identity: { displayName: "Pessoa Sintética", avatarUrl: null },
			context: {
				authUserId: "auth-synthetic-never-rendered",
				profileId: null,
				grants: [],
			},
		};
	}
	if (state === "no-grants") {
		return {
			state: "authenticated_linked_no_grants",
			identity: { displayName: "Pessoa Sintética", avatarUrl: null },
			context: {
				authUserId: "auth-synthetic-never-rendered",
				profileId: "profile-tda-synthetic-927",
				grants: [],
			},
		};
	}
	if (state === "project") {
		return {
			state: "authenticated_linked",
			identity: { displayName: "Pessoa Sintética", avatarUrl: null },
			context: {
				authUserId: "auth-synthetic-never-rendered",
				profileId: "profile-tda-synthetic-927",
				grants: allProjectGrants,
			},
		};
	}
	if (state === "multi") {
		return {
			state: "authenticated_linked",
			identity: {
				displayName:
					"Pessoa Sintética com um nome deliberadamente longo para reflow",
				avatarUrl: null,
			},
			context: {
				authUserId: "auth-synthetic-never-rendered",
				profileId: "profile-tda-synthetic-927",
				grants: [
					{
						action: EDIT_CAPABILITIES.transcriptRead,
						scopeType: "campaign",
						scopeId: "campaign-a",
						status: "active",
						startsAt: "2026-01-01T00:00:00Z",
						endsAt: null,
					},
					{
						action: EDIT_CAPABILITIES.worldLayoutEdit,
						scopeType: "campaign",
						scopeId: "campaign-b",
						status: "active",
						startsAt: "2026-01-01T00:00:00Z",
						endsAt: null,
					},
				],
			},
		};
	}
	return {
		state: "authenticated_linked",
		identity: { displayName: "Pessoa Sintética", avatarUrl: null },
		context: {
			authUserId: "auth-synthetic-never-rendered",
			profileId: "profile-tda-synthetic-927",
			grants: allCampaignGrants,
		},
	};
}

function syntheticCampaignAccess(
	state: string | undefined,
	access: AccountOverviewAccess,
): AccountCampaignAccessResult {
	if (state === "campaign-error")
		return { status: "unavailable", campaigns: [] };
	if (!access.context?.profileId || state === "project")
		return { status: "ready", campaigns: [] };
	if (state === "multi") {
		return {
			status: "ready",
			campaigns: [
				{
					technicalSlug: "campaign-a",
					name: "Campanha A",
					lifecycle: "active",
					capabilityGroups: effectiveAccountCampaignCapabilityGroups(
						access.context,
						"campaign-a",
					),
				},
				{
					technicalSlug: "campaign-b",
					name: "Antes que seja tarde — uma campanha com nome deliberadamente comprido para validar reflow",
					lifecycle: "active",
					capabilityGroups: effectiveAccountCampaignCapabilityGroups(
						access.context,
						"campaign-b",
					),
				},
			],
		};
	}
	if (access.state === "authenticated_linked") {
		return {
			status: "ready",
			campaigns: [
				{
					technicalSlug: "yuhara-main",
					name: "Crônicas da Mesa",
					lifecycle: "active",
					capabilityGroups: ACCOUNT_CAPABILITY_GROUPS,
				},
			],
		};
	}
	return { status: "ready", campaigns: [] };
}

export default async function AccountOverviewE2EFixture({
	searchParams,
}: {
	searchParams: Promise<{ state?: string }>;
}) {
	if (process.env.TDA_E2E_FIXTURES !== "true") notFound();
	const query = await searchParams;
	const access = syntheticAccess(query.state);

	return (
		<AccountOverview
			access={access}
			campaignAccess={syntheticCampaignAccess(query.state, access)}
			accessNotice={null}
			authEnabled={true}
		/>
	);
}
