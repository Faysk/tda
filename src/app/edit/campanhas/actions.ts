"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { safeReturnPath } from "@/features/auth/config";
import {
	createCampaign,
	setCampaignLifecycle,
	updateCampaign,
} from "@/features/campaigns/server";

function text(formData: FormData, key: string): string {
	const value = formData.get(key);
	return typeof value === "string" ? value : "";
}

function redirectWithResult(
	status: "criada" | "atualizada" | "arquivada" | "reativada",
	result: Awaited<
		ReturnType<
			typeof createCampaign | typeof updateCampaign | typeof setCampaignLifecycle
		>
	>,
	options: Readonly<{
		campaignId?: string;
		returnTo?: string;
	}> = {},
): never {
	const params = new URLSearchParams();
	if (result.ok) {
		// Campaign identity is also projected by the shared root navigation.
		revalidatePath("/", "layout");
		params.set("status", status);
	} else {
		params.set("erro", result.reason);
		if (result.field) params.set("campo", result.field);
	}
	if (options.campaignId) params.set("campanha", options.campaignId);
	if (options.returnTo) params.set("next", options.returnTo);
	redirect(`/edit/campanhas?${params.toString()}`);
}

export async function createCampaignAction(formData: FormData) {
	const routeKey = text(formData, "routeKey");
	const requestedTechnicalSlug = text(formData, "technicalSlug");
	const result = await createCampaign({
		name: text(formData, "name"),
		// Human-facing creation keeps the technical key in progressive disclosure.
		// When omitted, the initial public route is a deterministic, valid default.
		technicalSlug: requestedTechnicalSlug.trim() || routeKey,
		routeKey,
		description: text(formData, "description"),
		visibility: text(formData, "visibility"),
	});
	const returnTo = safeReturnPath(text(formData, "returnTo"));
	if (result.ok && returnTo === "/edit/processamento") {
		revalidatePath("/", "layout");
		redirect(
			`/edit/processamento?campanha=${encodeURIComponent(result.campaign.technicalSlug)}&campanhaCriada=1`,
		);
	}
	redirectWithResult("criada", result, {
		returnTo: returnTo === "/edit/processamento" ? returnTo : undefined,
	});
}

export async function updateCampaignAction(formData: FormData) {
	const campaignId = text(formData, "id");
	const result = await updateCampaign({
		id: campaignId,
		expectedUpdatedAt: text(formData, "expectedUpdatedAt"),
		name: text(formData, "name"),
		routeKey: text(formData, "routeKey"),
		description: text(formData, "description"),
		visibility: text(formData, "visibility"),
	});
	redirectWithResult("atualizada", result, { campaignId });
}

export async function setCampaignLifecycleAction(formData: FormData) {
	const campaignId = text(formData, "id");
	const lifecycle = text(formData, "lifecycle");
	const result = await setCampaignLifecycle({
		id: campaignId,
		expectedUpdatedAt: text(formData, "expectedUpdatedAt"),
		lifecycle,
	});
	redirectWithResult(lifecycle === "archived" ? "arquivada" : "reativada", result, {
		campaignId,
	});
}
