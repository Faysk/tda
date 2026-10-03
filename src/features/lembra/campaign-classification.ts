import {
	isCampaignRegistrySchemaGap,
	type CampaignRegistrySchemaError,
} from "@/features/campaigns/schema-compatibility";
import {
	isLembraUuid,
	type LembraCampaignClassification,
	type LembraCampaignMutationIntent,
} from "./model";

export type LembraCampaignRegistryError = CampaignRegistrySchemaError;

export function isLembraCampaignRegistryUnavailable(
	error: LembraCampaignRegistryError | null | undefined,
): boolean {
	return isCampaignRegistrySchemaGap(error);
}


function parseCampaignClassification(
	row: unknown,
): LembraCampaignClassification | null {
	if (!row || typeof row !== "object" || Array.isArray(row)) return null;
	const candidate = row as Record<string, unknown>;
	if (
		!isLembraUuid(candidate.id) ||
		typeof candidate.name !== "string" ||
		!candidate.name.trim() ||
		(candidate.lifecycle !== "active" && candidate.lifecycle !== "archived")
	) {
		return null;
	}
	return {
		id: candidate.id,
		name: candidate.name.trim(),
		lifecycle: candidate.lifecycle,
	};
}

export function mergeLembraCampaignClassifications(
	publicRows: unknown,
	discoverableRows: unknown,
): LembraCampaignClassification[] {
	const byId = new Map<string, LembraCampaignClassification>();
	for (const rows of [publicRows, discoverableRows]) {
		if (!Array.isArray(rows)) continue;
		for (const row of rows) {
			const campaign = parseCampaignClassification(row);
			if (campaign) byId.set(campaign.id, campaign);
		}
	}
	return [...byId.values()].sort(
		(left, right) =>
			left.name.localeCompare(right.name, "pt-BR") ||
			left.id.localeCompare(right.id),
	);
}

export function projectLembraCampaignClassification(
	campaignId: string | null,
	campaign: LembraCampaignClassification | null,
): Readonly<{
	campaign: LembraCampaignClassification | null;
	campaignRestricted: boolean;
}> {
	return {
		campaign,
		campaignRestricted: campaignId !== null && campaign === null,
	};
}

export type LembraCampaignMutationResolution =
	| Readonly<{
			ok: true;
			campaignId: string | null;
			campaign: LembraCampaignClassification | null;
			campaignRestricted: boolean;
	  }>
	| Readonly<{ ok: false }>;

export function resolveLembraCampaignMutation(
	input: Readonly<{
		currentCampaignId: string | null;
		currentCampaign: LembraCampaignClassification | null;
		intent: LembraCampaignMutationIntent;
		discoverableCampaigns: readonly LembraCampaignClassification[];
	}>,
): LembraCampaignMutationResolution {
	const currentProjection = projectLembraCampaignClassification(
		input.currentCampaignId,
		input.currentCampaign,
	);

	// A hidden classification is never rewritten from a browser intent. This keeps
	// title/description edits safe after revocation and prevents UUID probing from
	// becoming a way to clear or move a classification the viewer cannot discover.
	if (currentProjection.campaignRestricted) {
		return {
			ok: true,
			campaignId: input.currentCampaignId,
			campaign: null,
			campaignRestricted: true,
		};
	}

	if (input.intent.kind === "preserve") {
		return {
			ok: true,
			campaignId: input.currentCampaignId,
			campaign: input.currentCampaign,
			campaignRestricted: false,
		};
	}
	if (input.intent.kind === "clear") {
		return {
			ok: true,
			campaignId: null,
			campaign: null,
			campaignRestricted: false,
		};
	}

	const campaign =
		input.discoverableCampaigns.find(
			(candidate) => candidate.id === input.intent.campaignId,
		) ?? null;
	if (!campaign || campaign.lifecycle !== "active") return { ok: false };
	return {
		ok: true,
		campaignId: campaign.id,
		campaign,
		campaignRestricted: false,
	};
}
