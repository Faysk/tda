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
