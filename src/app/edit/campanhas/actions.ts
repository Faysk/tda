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
): never {
	if (result.ok) {
		revalidatePath("/campanhas");
		revalidatePath("/edit/campanhas");
		redirect(`/edit/campanhas?status=${status}`);
	}
	redirect(
		`/edit/campanhas?erro=${encodeURIComponent(result.reason)}${
			result.field ? `&campo=${encodeURIComponent(result.field)}` : ""
		}`,
	);
}

export async function createCampaignAction(formData: FormData) {
	const result = await createCampaign({
		name: text(formData, "name"),
		technicalSlug: text(formData, "technicalSlug"),
		routeKey: text(formData, "routeKey"),
		description: text(formData, "description"),
		visibility: text(formData, "visibility"),
	});
	if (result.ok) {
		const returnTo = safeReturnPath(text(formData, "returnTo"));
		if (returnTo === "/edit/processamento") {
			revalidatePath("/campanhas");
			revalidatePath("/edit/campanhas");
			redirect(
				`/edit/processamento?campanha=${encodeURIComponent(result.campaign.technicalSlug)}&campanhaCriada=1`,
			);
		}
	}
	redirectWithResult("criada", result);
}

export async function updateCampaignAction(formData: FormData) {
	const result = await updateCampaign({
		id: text(formData, "id"),
		expectedUpdatedAt: text(formData, "expectedUpdatedAt"),
		name: text(formData, "name"),
		routeKey: text(formData, "routeKey"),
		description: text(formData, "description"),
		visibility: text(formData, "visibility"),
	});
	redirectWithResult("atualizada", result);
}

export async function setCampaignLifecycleAction(formData: FormData) {
	const lifecycle = text(formData, "lifecycle");
	const result = await setCampaignLifecycle({
		id: text(formData, "id"),
		expectedUpdatedAt: text(formData, "expectedUpdatedAt"),
		lifecycle,
	});
	redirectWithResult(lifecycle === "archived" ? "arquivada" : "reativada", result);
}
