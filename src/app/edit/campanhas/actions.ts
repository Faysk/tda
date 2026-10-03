"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { safeReturnPath } from "@/features/auth/config";
import { suggestCampaignRouteKey } from "@/features/campaigns/model";
import {
	createCampaign,
	setCampaignLifecycle,
	updateCampaign,
} from "@/features/campaigns/server";

function text(formData: FormData, key: string): string {
	const value = formData.get(key);
	return typeof value === "string" ? value : "";
}

function failureQuery(
	result: Exclude<
		Awaited<
			ReturnType<
				typeof createCampaign | typeof updateCampaign | typeof setCampaignLifecycle
			>
		>,
		{ ok: true }
	>,
) {
	return `erro=${encodeURIComponent(result.reason)}${
		result.field ? `&campo=${encodeURIComponent(result.field)}` : ""
	}`;
}

function managerResult(
	status: "criada" | "atualizada" | "arquivada" | "reativada",
	result: Awaited<
		ReturnType<
			typeof createCampaign | typeof updateCampaign | typeof setCampaignLifecycle
		>
	>,
	context: "create" | string,
): never {
	if (result.ok) {
		revalidatePath("/", "layout");
		redirect(
			`/edit/campanhas?status=${status}&editar=${encodeURIComponent(
				result.campaign.id,
			)}`,
		);
	}
	const target =
		context === "create"
			? "nova=1"
			: `editar=${encodeURIComponent(context)}`;
	redirect(`/edit/campanhas?${target}&${failureQuery(result)}`);
}

export async function createCampaignAction(formData: FormData) {
	const name = text(formData, "name");
	const suggestedKey = suggestCampaignRouteKey(name);
	const result = await createCampaign({
		name,
		technicalSlug: text(formData, "technicalSlug") || suggestedKey,
		routeKey: text(formData, "routeKey") || suggestedKey,
		description: text(formData, "description"),
		visibility: text(formData, "visibility"),
	});
	if (result.ok) {
		const returnTo = safeReturnPath(text(formData, "returnTo"));
		if (returnTo === "/edit/processamento") {
			revalidatePath("/", "layout");
			redirect(
				`/edit/processamento?campanha=${encodeURIComponent(
					result.campaign.technicalSlug,
				)}&campanhaCriada=1`,
			);
		}
	}
	managerResult("criada", result, "create");
}

export async function updateCampaignAction(formData: FormData) {
	const id = text(formData, "id");
	const result = await updateCampaign({
		id,
		expectedUpdatedAt: text(formData, "expectedUpdatedAt"),
		name: text(formData, "name"),
		routeKey: text(formData, "routeKey"),
		description: text(formData, "description"),
		visibility: text(formData, "visibility"),
	});
	managerResult("atualizada", result, id);
}

export async function setCampaignLifecycleAction(formData: FormData) {
	const id = text(formData, "id");
	const lifecycle = text(formData, "lifecycle");
	const result = await setCampaignLifecycle({
		id,
		expectedUpdatedAt: text(formData, "expectedUpdatedAt"),
		lifecycle,
	});
	managerResult(
		lifecycle === "archived" ? "arquivada" : "reativada",
		result,
		id,
	);
}
