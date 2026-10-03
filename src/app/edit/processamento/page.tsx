import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CampaignRoutePicker } from "@/features/campaigns/campaign-route-picker";
import { canManageCampaignRegistry } from "@/features/campaigns/policy";
import { readEligibleProcessingCampaigns } from "@/features/campaigns/processing";
import { currentAccess } from "@/features/auth/server";
import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
} from "@/features/edit/access/policy";
import {
	processingCampaignHref,
	type ProcessingCampaignOption,
} from "@/features/edit/processing/campaign-context";
import { ProcessingPanel } from "@/features/edit/processing/panel";
import styles from "@/features/edit/processing/processing.module.css";
import pageStyles from "./page.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	title: "Processamento",
	description: "Fila e conexão com o serviço local de processamento.",
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

function ProcessingCampaignEntry({
	campaigns,
	invalidSelection,
	campaignCreated,
	canManageCampaigns,
}: Readonly<{
	campaigns: readonly ProcessingCampaignOption[];
	invalidSelection: boolean;
	campaignCreated: boolean;
	canManageCampaigns: boolean;
}>) {
	const manageHref = canManageCampaigns
		? "/edit/campanhas?next=%2Fedit%2Fprocessamento"
		: undefined;

	return (
		<section className={pageStyles.campaignGate} aria-labelledby="processing-campaign-title">
			<p className={pageStyles.eyebrow}>Edit · processamento</p>
			<h1 id="processing-campaign-title">Onde vamos trabalhar?</h1>
			<p>
				Escolha a campanha deste processamento. A campanha só é aplicada quando
				você abrir o workspace; nenhum contexto é escolhido silenciosamente.
			</p>
			{invalidSelection ? (
				<p className={pageStyles.campaignAlert} role="alert">
					{campaignCreated
						? "A campanha foi criada, mas seu perfil ainda não possui acesso de processamento nela. A identidade foi preservada e nenhuma permissão foi concedida automaticamente."
						: "A campanha pedida não está disponível ou você não possui acesso a ela. Nenhuma outra campanha foi escolhida automaticamente."}
				</p>
			) : null}
			{campaigns.length ? (
				<CampaignRoutePicker
					ariaLabel="Campanha do processamento"
					label="Campanha"
					behavior="confirmed"
					confirmLabel="Abrir processamento"
					pendingLabel="Abrindo processamento…"
					value=""
					options={campaigns.map((campaign) => ({
						value: campaign.technicalSlug,
						label: campaign.name,
						lifecycle: "active" as const,
						href: processingCampaignHref(campaign.technicalSlug),
					}))}
					canManage={canManageCampaigns}
					manageHref={manageHref}
				/>
			) : (
				<div className={pageStyles.campaignEmpty} role="status">
					<strong>Nenhuma campanha ativa disponível para processamento.</strong>
					<span>
						Seu perfil não possui uma campanha ativa elegível para processamento local.
					</span>
				</div>
			)}
		</section>
	);
}

export default async function ProcessingPage({ searchParams }: Props) {
	const [params, access] = await Promise.all([searchParams, currentAccess()]);
	if (access.state === "anonymous")
		redirect("/entrar?next=%2Fedit%2Fprocessamento");
	if (access.state === "unavailable")
		redirect("/conta?acesso=indisponivel");
	if (!access.context?.profileId)
		redirect("/conta?acesso=negado");

	const eligible = await readEligibleProcessingCampaigns(access.context);
	if (!eligible.ok) {
		return (
			<section
				className={pageStyles.campaignGate}
				aria-labelledby="processing-campaign-unavailable"
				role="status"
			>
				<p className={pageStyles.eyebrow}>Edit · processamento</p>
				<h1 id="processing-campaign-unavailable">Campanhas indisponíveis</h1>
				<p>
					A sessão está autenticada, mas o registry de campanhas não pôde ser
					consultado com segurança. Nenhum contexto de processamento foi assumido.
				</p>
			</section>
		);
	}

	const requestedCampaign = queryValue(params, "campanha");
	const campaignCreated =
		requestedCampaign !== null && queryValue(params, "campanhaCriada") === "1";
	if (!requestedCampaign && eligible.campaigns.length === 1)
		redirect(processingCampaignHref(eligible.campaigns[0]!.technicalSlug));

	const selected = requestedCampaign
		? eligible.campaigns.find(
				(campaign) => campaign.technicalSlug === requestedCampaign,
			) ?? null
		: null;
	const canManageCampaigns = canManageCampaignRegistry(access.context);

	if (!selected) {
		return (
			<ProcessingCampaignEntry
				campaigns={eligible.campaigns}
				invalidSelection={Boolean(requestedCampaign)}
				campaignCreated={campaignCreated}
				canManageCampaigns={canManageCampaigns}
			/>
		);
	}

	const activityBarksManage = authorizeCampaignCapability(
		access.context,
		EDIT_CAPABILITIES.activityBarksManage,
		selected.technicalSlug,
	).ok;
	const publicationEnabled =
		process.env.TDA_TRANSCRIPT_PUBLICATION_ENABLED === "true" &&
		authorizeCampaignCapability(
			access.context,
			EDIT_CAPABILITIES.transcriptPublish,
			selected.technicalSlug,
		).ok;

	return (
		<section
			className={styles.page}
			data-processing-workspace="true"
			data-layout-family="workspace"
			data-layout-role="expansive"
		>
			<h1 className={pageStyles.visuallyHidden}>Processamento</h1>

			<ProcessingPanel
				campaignId={selected.technicalSlug}
				campaignName={selected.name}
				campaignOptions={eligible.campaigns}
				publicationEnabled={publicationEnabled}
				activityBarksManage={activityBarksManage}
				activityPackScope={`${access.context.profileId}:${selected.technicalSlug}`}
				canManageCampaigns={canManageCampaigns}
			/>
		</section>
	);
}
