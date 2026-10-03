import type { LembraCampaignClassification, LembraCampaignMutation } from "./model";
import {
	isCampaignRegistrySchemaGap,
	type CampaignRegistrySchemaError,
} from "@/features/campaigns/schema-compatibility";

export type LembraCampaignRegistryError = CampaignRegistrySchemaError;

export function isLembraCampaignRegistryUnavailable(
	error: LembraCampaignRegistryError | null | undefined,
): boolean {
	return isCampaignRegistrySchemaGap(error);
}


export type LembraCampaignMutationResolution =
	| Readonly<{
		ok: true;
		campaignId: string | null;
		campaign: LembraCampaignClassification | null;
	  }>
	| Readonly<{ ok: false; reason: "forbidden" }>;

export function resolveLembraCampaignMutation(
	currentCampaignId: string | null,
	visibleCampaigns: readonly LembraCampaignClassification[],
	mutation: LembraCampaignMutation,
): LembraCampaignMutationResolution {
	const visibleById = new Map(
		visibleCampaigns.map((campaign) => [campaign.id, campaign]),
	);

	if (mutation.kind === "preserve") {
		return {
			ok: true,
			campaignId: currentCampaignId,
			campaign: currentCampaignId
				? visibleById.get(currentCampaignId) ?? null
				: null,
		};
	}

	if (currentCampaignId && !visibleById.has(currentCampaignId)) {
		return { ok: false, reason: "forbidden" };
	}

	if (mutation.kind === "clear") {
		return { ok: true, campaignId: null, campaign: null };
	}

	const target = visibleById.get(mutation.campaignId);
	if (!target || target.lifecycle !== "active") {
		return { ok: false, reason: "forbidden" };
	}

	return {
		ok: true,
		campaignId: target.id,
		campaign: target,
	};
}


export function lembraCampaignMutationFromSelection(
	currentVisibleCampaignId: string | null,
	nextCampaignId: string | null,
): LembraCampaignMutation {
	if (nextCampaignId === currentVisibleCampaignId) {
		return { kind: "preserve" };
	}
	return nextCampaignId
		? { kind: "set", campaignId: nextCampaignId }
		: { kind: "clear" };
}
