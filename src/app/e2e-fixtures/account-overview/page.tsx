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
			grants: allGrants,
		},
	};
}

export default async function AccountOverviewE2EFixture({
	searchParams,
}: {
	searchParams: Promise<{ state?: string }>;
}) {
	if (process.env.TDA_E2E_FIXTURES !== "true") notFound();
	const query = await searchParams;

	return (
		<AccountOverview
			access={syntheticAccess(query.state)}
			accessNotice={null}
			authEnabled={true}
			campaigns={
				query.state === "unavailable" ? null :
				query.state === "anonymous" || query.state === "unlinked" || query.state === "no-grants"
					? []
					: fixtureCampaigns
			}
		/>
	);
}
