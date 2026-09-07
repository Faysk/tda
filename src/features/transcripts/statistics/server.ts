import "server-only";
import { authorizeCampaignCapabilityServer } from "@/features/auth/server";
import { readStatistics } from "./repository";

export async function getTranscriptStatistics(campaignSlug: string) {
	if (!/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/u.test(campaignSlug))
		return { ok: false, reason: "validation" } as const;
	try {
		const access = await authorizeCampaignCapabilityServer({
			action: "campaign.transcript.read",
			campaignSlug,
		});
		if (!access.ok) return access;
		const value = await readStatistics(campaignSlug);
		return { ok: true, value } as const;
	} catch {
		return { ok: false, reason: "dependency_unavailable" } as const;
	}
}
