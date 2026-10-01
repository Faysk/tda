"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { authorizeCampaignCapabilityServer } from "@/features/auth/server";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import { editDataClient } from "@/integrations/supabase/server";

const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SAFE_CAMPAIGN_SLUG = /^[A-Za-z0-9_-]{1,128}$/u;
const MAX_REVIEWER_NOTES = 2000;
const REVIEW_DECISIONS = new Set([
	"approved_canon",
	"rejected",
	"interpretation",
	"possible_hook",
	"retcon_pending",
	"private",
]);

function reviewRedirect(
	campaignSlug: string | null,
	kind: "resultado" | "erro",
	value: string,
): never {
	const params = new URLSearchParams({ [kind]: value });
	const path =
		campaignSlug && SAFE_CAMPAIGN_SLUG.test(campaignSlug)
			? `/edit/${encodeURIComponent(campaignSlug)}/revisao`
			: "/edit/revisao";
	redirect(`${path}?${params.toString()}`);
}

function knownFailure(reason: unknown) {
	return (
		reason === "forbidden" ||
		reason === "invalid_payload" ||
		reason === "invalid_state" ||
		reason === "conflict" ||
		reason === "not_found" ||
		reason === "source_required"
	);
}

async function campaignMutationFailure(
	campaignSlug: string,
): Promise<"dependency_unavailable" | "not_found" | "campaign_archived" | null> {
	const client = editDataClient();
	if (!client) return "dependency_unavailable";
	const { data, error } = await client
		.from("campaigns")
		.select("lifecycle")
		.eq("slug", campaignSlug)
		.maybeSingle();
	if (error) return "dependency_unavailable";
	if (!data) return "not_found";
	return data.lifecycle === "active" ? null : "campaign_archived";
}

export async function reviewCanonCandidateFormAction(
	formData: FormData,
): Promise<never> {
	const campaignSlug = String(formData.get("campaignSlug") ?? "").trim();
	const candidateId = String(formData.get("candidateId") ?? "").trim();
	const reviewerNotes = String(formData.get("reviewerNotes") ?? "").trim();
	const decision = String(formData.get("decision") ?? "").trim();

	if (
		!SAFE_CAMPAIGN_SLUG.test(campaignSlug) ||
		!UUID_PATTERN.test(candidateId) ||
		reviewerNotes.length > MAX_REVIEWER_NOTES ||
		!REVIEW_DECISIONS.has(decision)
	) {
		return reviewRedirect(null, "erro", "invalid_payload");
	}

	const capability =
		decision === "approved_canon"
			? EDIT_CAPABILITIES.canonApprove
			: EDIT_CAPABILITIES.reviewManage;
	const access = await authorizeCampaignCapabilityServer({
		action: capability,
		campaignSlug,
	});
	if (!access.ok) return reviewRedirect(campaignSlug, "erro", access.reason);

	const lifecycleFailure = await campaignMutationFailure(campaignSlug);
	if (lifecycleFailure)
		return reviewRedirect(campaignSlug, "erro", lifecycleFailure);

	const client = editDataClient();
	if (!client)
		return reviewRedirect(campaignSlug, "erro", "dependency_unavailable");

	if (decision === "approved_canon") {
		const { data, error } = await client.rpc("approve_canon_candidate_atomic", {
			p_auth_user_id: access.authUserId,
			p_actor_profile_id: access.profileId,
			p_campaign_slug: campaignSlug,
			p_candidate_id: candidateId,
			p_reviewer_notes: reviewerNotes || null,
		});
		if (error || !data || typeof data !== "object" || Array.isArray(data)) {
			console.error("Canon candidate approval failed");
			return reviewRedirect(campaignSlug, "erro", "dependency_unavailable");
		}

		const payload = data as Readonly<Record<string, unknown>>;
		if (
			payload.ok === true &&
			(payload.status === "approved" || payload.status === "unchanged")
		) {
			revalidatePath("/edit/revisao");
		revalidatePath(`/edit/${encodeURIComponent(campaignSlug)}/revisao`);
			revalidatePath("/mundo");
			return reviewRedirect(campaignSlug, "resultado", String(payload.status));
		}
		if (knownFailure(payload.reason)) {
			return reviewRedirect(campaignSlug, "erro", String(payload.reason));
		}
		return reviewRedirect(campaignSlug, "erro", "dependency_unavailable");
	}

	const { data, error } = await client.rpc("review_canon_candidate_atomic", {
		p_auth_user_id: access.authUserId,
		p_actor_profile_id: access.profileId,
		p_campaign_slug: campaignSlug,
		p_candidate_id: candidateId,
		p_decision: decision,
		p_reviewer_notes: reviewerNotes || null,
	});
	if (error || !data || typeof data !== "object" || Array.isArray(data)) {
		console.error("Canon candidate triage failed");
		return reviewRedirect(campaignSlug, "erro", "dependency_unavailable");
	}

	const payload = data as Readonly<Record<string, unknown>>;
	if (
		payload.ok === true &&
		(payload.status === "reviewed" || payload.status === "unchanged")
	) {
		revalidatePath("/edit/revisao");
		revalidatePath(`/edit/${encodeURIComponent(campaignSlug)}/revisao`);
		return reviewRedirect(
			campaignSlug,
			"resultado",
			payload.status === "unchanged" ? "unchanged" : decision,
		);
	}
	if (knownFailure(payload.reason)) {
		return reviewRedirect(campaignSlug, "erro", String(payload.reason));
	}
	return reviewRedirect(campaignSlug, "erro", "dependency_unavailable");
}
