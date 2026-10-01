import "server-only";

import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import {
	authorizeSessionCampaignTarget,
	type AuthorizedSessionCampaignTarget,
	type SessionCampaignAccessFailure,
} from "./session-campaign-access";

export type SessionCoverMediaAccessFailure = SessionCampaignAccessFailure;
export type AuthorizedSessionCoverTarget = AuthorizedSessionCampaignTarget;

export async function authorizeSessionCoverTarget(sessionId: string) {
	return authorizeSessionCampaignTarget(
		sessionId,
		EDIT_CAPABILITIES.contentEdit,
	);
}
