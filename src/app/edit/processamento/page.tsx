import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { OperationalPageHeader } from "@/components/operational-page-header";
import { CampaignNavigationPicker } from "@/features/campaigns/campaign-navigation-picker";
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
	return (
		<section
			className={pageStyles.campaignGate}
			data-layout-family="workspace"
			data-layout-role="editorial"
		>
			<OperationalPageHeader
				eyebrow="Edit · Processamento"
				title="Escolha a campanha"
				description={
					<p>
						Escolha onde trabalhar. A campanha define o contexto da fila,
						resultados e novas transcrições.
					</p>
				}
			/>
			{invalidSelection ? (
				<p className={pageStyles.campaignAlert} role="alert">
					{campaignCreated
						? "A campanha foi criada, mas seu perfil ainda não pode processar nela. A identidade foi preservada e nenhuma permissão foi concedida automaticamente."
						: "A campanha pedida não está disponível para processamento. Nenhuma outra campanha foi escolhida automaticamente."}
				</p>
			) : null}
			{campaigns.length ? (
				<div className={pageStyles.campaignPicker}>
					<span className={pageStyles.campaignLabel}>Campanha</span>
					<CampaignNavigationPicker
						value=""
						options={campaigns.map((campaign) => ({
							value: campaign.technicalSlug,
							label: campaign.name,
							disambiguation: campaign.routeKey,
							href: processingCampaignHref(campaign.technicalSlug),
							lifecycle: "active",
						}))}
						ariaLabel="Campanha do processamento"
						selectClassName={pageStyles.campaignSelect}
						canManage={canManageCampaigns}
						manageHref="/edit/campanhas?next=%2Fedit%2Fprocessamento"
						manageTarget="_self"
						pendingLabel="Abrindo processamento…"
					/>
				</div>
			) : (
				<div className={pageStyles.campaignEmpty} role="status">
					<strong>Nenhuma campanha disponível para processamento.</strong>
					<span>
						Seu perfil não possui uma campanha ativa em que possa iniciar
						processamento local.
					</span>
					{canManageCampaigns ? (
						<Link
							className={pageStyles.campaignManageLink}
							href="/edit/campanhas?next=%2Fedit%2Fprocessamento"
						>
							Criar ou gerenciar campanhas
						</Link>
					) : null}
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
				data-layout-family="workspace"
				data-layout-role="editorial"
				role="status"
			>
				<OperationalPageHeader
					eyebrow="Edit · Processamento"
					title="Campanhas indisponíveis"
					description={
						<p>
							Não foi possível consultar as campanhas agora. Nenhum contexto
							foi assumido.
						</p>
					}
				/>
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
				canManageCampaigns={canManageCampaigns}
				publicationEnabled={publicationEnabled}
				activityBarksManage={activityBarksManage}
				activityPackScope={`${access.context.profileId}:${selected.technicalSlug}`}
			/>
		</section>
	);
}
