"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { authorizeCampaignCapabilityServer } from "@/features/auth/server";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import { editDataClient } from "@/integrations/supabase/server";

const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_REVIEWER_NOTES = 2000;

function reviewRedirect(kind: "resultado" | "erro", value: string): never {
	redirect(`/edit/revisao?${kind}=${encodeURIComponent(value)}`);
}

export async function approveCanonCandidateFormAction(
	formData: FormData,
): Promise<never> {
	const candidateId = String(formData.get("candidateId") ?? "").trim();
	const reviewerNotes = String(formData.get("reviewerNotes") ?? "").trim();

	if (
		!UUID_PATTERN.test(candidateId) ||
		reviewerNotes.length > MAX_REVIEWER_NOTES
	) {
		return reviewRedirect("erro", "invalid_payload");
	}

	const access = await authorizeCampaignCapabilityServer({
		action: EDIT_CAPABILITIES.canonApprove,
		campaignSlug: CAMPAIGN_SLUG,
	});
	if (!access.ok) return reviewRedirect("erro", access.reason);

	const client = editDataClient();
	if (!client) return reviewRedirect("erro", "dependency_unavailable");

	const { data, error } = await client.rpc("approve_canon_candidate_atomic", {
		p_auth_user_id: access.authUserId,
		p_actor_profile_id: access.profileId,
		p_campaign_slug: CAMPAIGN_SLUG,
		p_candidate_id: candidateId,
		p_reviewer_notes: reviewerNotes || null,
	});
	if (error || !data || typeof data !== "object" || Array.isArray(data)) {
		console.error("Canon candidate approval failed");
		return reviewRedirect("erro", "dependency_unavailable");
	}

	const payload = data as Readonly<Record<string, unknown>>;
	if (
		payload.ok === true &&
		(payload.status === "approved" || payload.status === "unchanged")
	) {
		revalidatePath("/edit/revisao");
		revalidatePath("/mundo");
		return reviewRedirect("resultado", payload.status);
	}

	if (
		payload.reason === "forbidden" ||
		payload.reason === "invalid_payload" ||
		payload.reason === "invalid_state" ||
		payload.reason === "conflict" ||
		payload.reason === "not_found"
	) {
		return reviewRedirect("erro", payload.reason);
	}

	return reviewRedirect("erro", "dependency_unavailable");
}
