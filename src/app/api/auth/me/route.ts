import { currentAccess } from "@/features/auth/server";
import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
} from "@/features/edit/access/policy";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";

export async function GET() {
	const access = await currentAccess();
	const context = access.context;
	const authenticated =
		access.state === "authenticated_unlinked" ||
		access.state === "authenticated_linked" ||
		access.state === "authenticated_linked_no_grants";
	const capabilities =
		authenticated && context
			? Object.values(EDIT_CAPABILITIES).filter(
					(action) =>
						authorizeCampaignCapability(context, action, CAMPAIGN_SLUG).ok,
				)
			: [];
	return Response.json(
		{
			state: access.state,
			scope: { type: "campaign", id: CAMPAIGN_SLUG },
			...(authenticated
				? {
						identity: access.identity,
						capabilities,
					}
				: {}),
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
