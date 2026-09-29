import type { Metadata } from "next";
import { requireCapability } from "@/features/auth/server";
import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
} from "@/features/edit/access/policy";
import { ProcessingPanel } from "@/features/edit/processing/panel";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import styles from "@/features/edit/processing/processing.module.css";
import pageStyles from "./page.module.css";

export const metadata: Metadata = {
	title: "Processamento",
	description: "Fila e conexão com o serviço local de processamento.",
};

export default async function ProcessingPage() {
	const access = await requireCapability(
		EDIT_CAPABILITIES.localProcess,
		"/edit/processamento",
	);
	const activityBarksManage = authorizeCampaignCapability(
		access,
		EDIT_CAPABILITIES.activityBarksManage,
		CAMPAIGN_SLUG,
	).ok;
	const publicationEnabled =
		process.env.TDA_TRANSCRIPT_PUBLICATION_ENABLED === "true" &&
		authorizeCampaignCapability(
			access,
			EDIT_CAPABILITIES.transcriptPublish,
			CAMPAIGN_SLUG,
		).ok;

	return (
		<section
			className={styles.page}
			data-processing-workspace="true"
			data-layout-family="workspace"
			data-layout-role="expansive"
			data-workbench-shell="processing"
			data-scroll-owner="document-local-log"
		>
			<h1 className={pageStyles.visuallyHidden}>Processamento</h1>

			<ProcessingPanel
				publicationEnabled={publicationEnabled}
				activityBarksManage={activityBarksManage}
				activityPackScope={`${access.profileId ?? "unresolved"}:${CAMPAIGN_SLUG}`}
			/>

		</section>
	);
}
