import { currentAccess } from "@/features/auth/server";
import { readNavigationCampaigns } from "@/features/campaigns/navigation";

export async function GET() {
	const access = await currentAccess();
	const context = access.context;
	const authenticated =
		access.state === "authenticated_unlinked" ||
		access.state === "authenticated_linked" ||
		access.state === "authenticated_linked_no_grants";
	const navigation =
		authenticated && context
			? await readNavigationCampaigns(context)
			: { mode: "unavailable" as const, campaigns: [] };

	const legacyCapabilities =
		navigation.mode === "legacy_compatibility"
			? navigation.campaigns[0]?.capabilities ?? []
			: [];

	return Response.json(
		{
			state: access.state,
			scope:
				navigation.mode === "legacy_compatibility"
					? { type: "campaign", id: navigation.campaigns[0]?.technicalSlug ?? null }
					: { type: "project", id: "tda" },
			...(authenticated
				? {
						identity: access.identity,
						capabilities: legacyCapabilities,
						campaignsState: navigation.mode,
						campaigns: navigation.campaigns,
					}
				: {
						campaignsState:
							access.state === "unavailable" ? "unavailable" : "none",
						campaigns: [],
					}),
		},
		{
			status: access.state === "unavailable" ? 503 : 200,
			headers: {
				"Cache-Control": "private, no-store",
				Vary: "Cookie",
			},
		},
	);
}
