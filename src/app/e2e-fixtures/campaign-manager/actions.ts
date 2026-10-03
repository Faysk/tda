"use server";

import { redirect } from "next/navigation";

const FIXTURE = "/e2e-fixtures/campaign-manager";

function text(formData: FormData, key: string): string {
	const value = formData.get(key);
	return typeof value === "string" ? value : "";
}

export async function fixtureCreateCampaignAction(_formData: FormData) {
	redirect(`${FIXTURE}?status=criada`);
}

export async function fixtureUpdateCampaignAction(formData: FormData) {
	const campaignId = text(formData, "id");
	redirect(
		`${FIXTURE}?status=atualizada&campanha=${encodeURIComponent(campaignId)}`,
	);
}

export async function fixtureLifecycleAction(formData: FormData) {
	const campaignId = text(formData, "id");
	const lifecycle = text(formData, "lifecycle");
	const status = lifecycle === "archived" ? "arquivada" : "reativada";
	const lifecycleState =
		lifecycle === "archived" ? `&arquivada=${encodeURIComponent(campaignId)}` : "";
	redirect(
		`${FIXTURE}?status=${status}&campanha=${encodeURIComponent(campaignId)}${lifecycleState}`,
	);
}
