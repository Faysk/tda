import { notFound } from "next/navigation";
import {
	AccountOverview,
	type AccountOverviewAccess,
} from "@/features/auth/account-overview";
import type { AccountCampaignAccess } from "@/features/auth/account-campaign-access";
import {
	effectiveAccountCapabilityGroups,
} from "@/features/auth/account-access";
import {
	EDIT_CAPABILITIES,
	type EditAccessContext,
} from "@/features/edit/access/policy";

export const dynamic = "force-dynamic";

const CAMPAIGN_A = {
	technicalSlug: "yuhara-main",
	name: "Destino Sem Fim",
} as const;
const CAMPAIGN_B = {
	technicalSlug: "passos-retomados",
	name: "Passos Retomados — nome sintético deliberadamente comprido para reflow",
} as const;

function grant(
	action: string,
	scopeType: "campaign" | "project",
	scopeId: string,
): EditAccessContext["grants"][number] {
	return {
		action,
		scopeType,
		scopeId,
		status: "active",
		startsAt: "2026-01-01T00:00:00Z",
		endsAt: null,
	};
}

function grantsForMode(mode: string | undefined) {
	if (mode === "none") return [];
	if (mode === "a-only") {
		return [
			grant(EDIT_CAPABILITIES.contentEdit, "campaign", CAMPAIGN_A.technicalSlug),
			grant(EDIT_CAPABILITIES.permissionsManage, "campaign", CAMPAIGN_A.technicalSlug),
		];
	}
	if (mode === "b-only") {
		return [
			grant(EDIT_CAPABILITIES.transcriptRead, "campaign", CAMPAIGN_B.technicalSlug),
			grant(EDIT_CAPABILITIES.worldLayoutEdit, "campaign", CAMPAIGN_B.technicalSlug),
		];
	}
	if (mode === "multi") {
		return [
			grant(EDIT_CAPABILITIES.transcriptRead, "project", "tda"),
			grant(EDIT_CAPABILITIES.permissionsManage, "project", "tda"),
			grant(EDIT_CAPABILITIES.contentEdit, "campaign", CAMPAIGN_A.technicalSlug),
			grant(EDIT_CAPABILITIES.localProcess, "campaign", CAMPAIGN_A.technicalSlug),
			grant(EDIT_CAPABILITIES.worldLayoutEdit, "campaign", CAMPAIGN_B.technicalSlug),
		];
	}
	if (mode === "project-wide") {
		return Object.values(EDIT_CAPABILITIES).map((action) =>
			grant(action, "project", "tda"),
		);
	}
	return Object.values(EDIT_CAPABILITIES).map((action) =>
		grant(action, "campaign", CAMPAIGN_A.technicalSlug),
	);
}

function syntheticAccess(
	state: string | undefined,
	mode: string | undefined,
): AccountOverviewAccess {
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
	if (state === "no-grants" || mode === "none") {
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
			grants: grantsForMode(mode),
		},
	};
}

function campaignsForMode(mode: string | undefined) {
	if (mode === "none" || mode === "unavailable") return [];
	if (mode === "b-only") return [CAMPAIGN_B];
	if (mode === "multi" || mode === "project-wide") return [CAMPAIGN_A, CAMPAIGN_B];
	return [CAMPAIGN_A];
}

function syntheticCampaignAccess(
	access: AccountOverviewAccess,
	mode: string | undefined,
	requestedCampaignSlug: string | null,
): AccountCampaignAccess {
	if (mode === "unavailable") {
		return {
			state: "unavailable",
			campaigns: [],
			selectedCampaign: null,
			requestedCampaignUnavailable: false,
		};
	}
	if (!access.context?.profileId) {
		return {
			state: "ready",
			campaigns: [],
			selectedCampaign: null,
			requestedCampaignUnavailable: false,
		};
	}

	const campaigns =
		access.state === "authenticated_linked_no_grants"
			? []
			: campaignsForMode(mode);
	const requested =
		requestedCampaignSlug === null
			? null
			: campaigns.find(
					(campaign) => campaign.technicalSlug === requestedCampaignSlug,
				) ?? null;
	const selected =
		requested ??
		(requestedCampaignSlug === null && campaigns.length === 1
			? campaigns[0]
			: null);
	if (!selected) {
		return {
			state: "ready",
			campaigns,
			selectedCampaign: null,
			requestedCampaignUnavailable:
				requestedCampaignSlug !== null && requested === null,
		};
	}
	const capabilityGroups = effectiveAccountCapabilityGroups(
		access.context,
		selected.technicalSlug,
	);
	const items = capabilityGroups.flatMap((group) => group.items);
	return {
		state: "ready",
		campaigns,
		selectedCampaign: {
			...selected,
			capabilityGroups,
			projectCapabilityCount: items.filter((item) => item.scope === "project").length,
			campaignCapabilityCount: items.filter((item) => item.scope === "campaign").length,
		},
		requestedCampaignUnavailable: false,
	};
}

export default async function AccountOverviewE2EFixture({
	searchParams,
}: {
	searchParams: Promise<{ state?: string; mode?: string; campanha?: string }>;
}) {
	if (process.env.TDA_E2E_FIXTURES !== "true") notFound();
	const query = await searchParams;
	const access = syntheticAccess(query.state, query.mode);
	const campaignAccess = syntheticCampaignAccess(
		access,
		query.mode,
		query.campanha ?? null,
	);

	return (
		<AccountOverview
			access={access}
			campaignAccess={campaignAccess}
			accessNotice={query.state === "denied" ? "Acesso negado sintético." : null}
			deniedReturnTo={query.state === "denied" ? "/edit/mundo" : null}
			authEnabled={true}
		/>
	);
}
