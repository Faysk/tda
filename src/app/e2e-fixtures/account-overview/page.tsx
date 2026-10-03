import { notFound } from "next/navigation";
import {
	AccountOverview,
	type AccountOverviewAccess,
} from "@/features/auth/account-overview";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";

export const dynamic = "force-dynamic";

const allGrants = Object.values(EDIT_CAPABILITIES).map((action) => ({
	action,
	scopeType: "campaign",
	scopeId: "yuhara-main",
	status: "active",
	startsAt: "2026-01-01T00:00:00Z",
	endsAt: null,
}));

const fixtureCampaigns = [
	{
		technicalSlug: "yuhara-main",
		name: "Crônicas da Mesa",
		lifecycle: "active" as const,
	},
];

const multiCampaigns = [
	...fixtureCampaigns,
	{
		technicalSlug: "campaign-b",
		name: "A Campanha Sintética Com Nome Deliberadamente Muito Longo Para Validar Reflow",
		lifecycle: "active" as const,
	},
];

const multiCampaignGrants = [
	...allGrants,
	{
		action: EDIT_CAPABILITIES.contentEdit,
		scopeType: "campaign",
		scopeId: "campaign-b",
		status: "active",
		startsAt: "2026-01-01T00:00:00Z",
		endsAt: null,
	},
];

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
	return {
		state: "authenticated_linked",
		identity: { displayName: "Pessoa Sintética", avatarUrl: null },
		context: {
			authUserId: "auth-synthetic-never-rendered",
			profileId: "profile-tda-synthetic-927",
			grants: state === "multi" ? multiCampaignGrants : allGrants,
		},
	};
}

export default async function AccountOverviewE2EFixture({
	searchParams,
}: {
	searchParams: Promise<{ state?: string; campanha?: string }>;
}) {
	if (process.env.TDA_E2E_FIXTURES !== "true") notFound();
	const query = await searchParams;

	const campaigns =
		query.state === "unavailable"
			? null
			: query.state === "anonymous" ||
					query.state === "unlinked" ||
					query.state === "no-grants"
				? []
				: query.state === "multi"
					? multiCampaigns
					: fixtureCampaigns;
	const requestedCampaign = query.campanha ?? null;
	const selectedCampaign =
		campaigns === null
			? null
			: campaigns.find(
					(campaign) => campaign.technicalSlug === requestedCampaign,
				) ??
				(requestedCampaign === null && campaigns.length === 1
					? campaigns[0]
					: null);

	return (
		<AccountOverview
			access={syntheticAccess(query.state)}
			accessNotice={null}
			authEnabled={true}
			campaigns={campaigns}
			selectedCampaignSlug={selectedCampaign?.technicalSlug ?? null}
			requestedCampaignUnavailable={
				requestedCampaign !== null &&
				campaigns !== null &&
				selectedCampaign === null
			}
		/>
	);
}
