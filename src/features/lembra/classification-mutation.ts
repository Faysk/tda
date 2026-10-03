import type { LembraCampaignMutationIntent } from "./model";

export type LembraCampaignColumnPatch = Readonly<{
	campaign_id?: string | null;
}>;

/**
 * Converts explicit UI intent into the only campaign column mutation allowed.
 * An omitted campaign_id is materially different from campaign_id = null:
 * omission preserves classifications the current viewer is not allowed to see.
 */
export function lembraCampaignColumnPatch(
	intent: LembraCampaignMutationIntent,
): LembraCampaignColumnPatch {
	if (intent.kind === "preserve") return {};
	if (intent.kind === "clear") return { campaign_id: null };
	return { campaign_id: intent.campaignId };
}

/**
 * Under read-plane total concealment, reclassification against an
 * undiscoverable existing classification becomes preserve. This prevents a
 * stale tab from clearing or replacing a binding after revocation.
 */
export function concealUndiscoverableLembraReclassification(
	intent: LembraCampaignMutationIntent,
	currentCampaignId: string | null,
	currentCampaignDiscoverable: boolean,
): LembraCampaignMutationIntent {
	if (
		intent.kind !== "preserve" &&
		currentCampaignId !== null &&
		!currentCampaignDiscoverable
	) {
		return { kind: "preserve" };
	}
	return intent;
}
