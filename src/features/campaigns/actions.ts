"use server";

import { revalidatePath } from "next/cache";
import type { CampaignCreateInput, CampaignMutationResult } from "./model";
import { createCampaign } from "./server";

export async function createCampaignRegistryAction(
	input: CampaignCreateInput,
): Promise<CampaignMutationResult> {
	const result = await createCampaign(input);
	if (result.ok) {
		revalidatePath("/", "layout");
	}
	return result;
}
