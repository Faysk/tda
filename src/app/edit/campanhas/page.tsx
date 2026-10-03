import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { safeReturnPath } from "@/features/auth/config";
import {
	CampaignManagementView,
	type CampaignManagerFeedback,
} from "@/features/campaigns/management-view";
import { readManageableCampaigns } from "@/features/campaigns/server";
import {
	createCampaignAction,
	setCampaignLifecycleAction,
	updateCampaignAction,
} from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	title: "Campanhas · Edit",
	description: "Crie, organize e gerencie as campanhas do TDA.",
};

type Props = {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function queryValue(
	params: Record<string, string | string[] | undefined>,
	key: string,
): string | null {
	const value = params[key];
	return typeof value === "string" ? value : null;
}

function validatedReturnPath(value: string | null): string | null {
	if (!value) return null;
	const safe = safeReturnPath(value);
	if (safe === "/conta" && value !== "/conta") return null;
	return safe;
}

export default async function CampaignManagementPage({ searchParams }: Props) {
	const [params, result] = await Promise.all([
		searchParams,
		readManageableCampaigns(),
	]);

	if (!result.ok) {
		if (result.reason === "unauthenticated")
			redirect("/entrar?next=%2Fedit%2Fcampanhas");
		if (result.reason === "profile_unresolved" || result.reason === "forbidden")
			redirect("/conta?acesso=negado");
	}

	const feedback: CampaignManagerFeedback = {
		status: queryValue(params, "status"),
		error: queryValue(params, "erro"),
		field: queryValue(params, "campo"),
		campaignId: queryValue(params, "campanha"),
	};
	const returnTo = validatedReturnPath(queryValue(params, "next"));

	return (
		<CampaignManagementView
			campaigns={result.ok ? result.campaigns : null}
			feedback={feedback}
			returnTo={returnTo}
			createAction={createCampaignAction}
			updateAction={updateCampaignAction}
			lifecycleAction={setCampaignLifecycleAction}
		/>
	);
}
