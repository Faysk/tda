"use server";

import { revalidatePath } from "next/cache";
import type { CampaignMutationResult } from "./model";
import { createCampaign } from "./server";

export type ContextCampaignCreateInput = Readonly<{
	name: string;
	technicalSlug: string;
	routeKey: string;
	description: string;
	visibility: "public" | "private";
}>;

/**
 * Contextual campaign creation reuses the canonical campaign backend.
 *
 * UI callers receive a result instead of a redirect so an in-progress feature
 * can preserve its local draft. Authorization is still re-evaluated inside
 * createCampaign() on every request.
 */
export async function createCampaignContextAction(
	input: ContextCampaignCreateInput,
): Promise<CampaignMutationResult> {
	const result = await createCampaign(input);
	if (result.ok) revalidatePath("/", "layout");
	return result;
}
