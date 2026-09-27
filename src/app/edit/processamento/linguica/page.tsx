import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCapability } from "@/features/auth/server";
import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
} from "@/features/edit/access/policy";
import { ActivityPackAdmin } from "@/features/edit/processing/activity-pack-admin";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import styles from "./page.module.css";

export const metadata: Metadata = {
	title: "Linguiça no Log | TDA",
	description: "Administração local de activity bark packs do processamento.",
};

export default async function ActivityPackPage() {
	const access = await requireCapability(
		EDIT_CAPABILITIES.localProcess,
		"/edit/processamento/linguica",
	);
	if (
		!access.profileId ||
		!authorizeCampaignCapability(
			access,
			EDIT_CAPABILITIES.activityBarksManage,
			CAMPAIGN_SLUG,
		).ok
	)
		redirect("/conta?acesso=negado");

	return (
		<div>
			<p><Link href="/edit/processamento">
				← Processamento
			</Link>
			<ActivityPackAdmin
				scope={{ profileId: access.profileId, campaignSlug: CAMPAIGN_SLUG }}
			/>
		</div>
	);
}
