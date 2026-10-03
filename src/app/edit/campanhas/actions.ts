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

function optionalReturnPath(formData: FormData): string | null {
	const raw = text(formData, "returnTo");
	if (!raw) return null;
	const safe = safeReturnPath(raw);
	if (safe === "/conta" && raw !== "/conta") return null;
	return safe;
}

function redirectWithResult(
	status: "criada" | "atualizada" | "arquivada" | "reativada",
	result: Awaited<
		ReturnType<
			typeof createCampaign | typeof updateCampaign | typeof setCampaignLifecycle
		>
	>,
	returnTo: string | null,
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
	if (returnTo) params.set("next", returnTo);
	redirect(`/edit/campanhas?${params.toString()}`);
}

export async function createCampaignAction(formData: FormData) {
	const returnTo = optionalReturnPath(formData);
	const result = await createCampaign({
		name: text(formData, "name"),
		technicalSlug: text(formData, "technicalSlug"),
		routeKey: text(formData, "routeKey"),
		description: text(formData, "description"),
		visibility: text(formData, "visibility"),
	});
	if (result.ok && returnTo === "/edit/processamento") {
		revalidatePath("/", "layout");
		redirect(
			`/edit/processamento?campanha=${encodeURIComponent(result.campaign.technicalSlug)}&campanhaCriada=1`,
		);
	}
	redirectWithResult("criada", result, returnTo);
}

export async function updateCampaignAction(formData: FormData) {
	const returnTo = optionalReturnPath(formData);
	const result = await updateCampaign({
		id: text(formData, "id"),
		expectedUpdatedAt: text(formData, "expectedUpdatedAt"),
		name: text(formData, "name"),
		routeKey: text(formData, "routeKey"),
		description: text(formData, "description"),
		visibility: text(formData, "visibility"),
	});
	redirectWithResult("atualizada", result, returnTo);
}

export async function setCampaignLifecycleAction(formData: FormData) {
	const returnTo = optionalReturnPath(formData);
	const lifecycle = text(formData, "lifecycle");
	const result = await setCampaignLifecycle({
		id: text(formData, "id"),
		expectedUpdatedAt: text(formData, "expectedUpdatedAt"),
		lifecycle,
	});
	redirectWithResult(
		lifecycle === "archived" ? "arquivada" : "reativada",
		result,
		returnTo,
	);
}
