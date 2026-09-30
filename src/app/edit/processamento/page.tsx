import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
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

function CampaignPicker({
	campaigns,
	invalidSelection,
	canManageCampaigns,
}: Readonly<{
	campaigns: readonly ProcessingCampaignOption[];
	invalidSelection: boolean;
	canManageCampaigns: boolean;
}>) {
	return (
		<section className={pageStyles.campaignGate} aria-labelledby="processing-campaign-title">
			<p className={pageStyles.eyebrow}>Edit · processamento</p>
			<h1 id="processing-campaign-title">Escolha a campanha</h1>
			<p>
				Cada processamento, recovery e handoff pertence a uma campanha
				explícita. A seleção abaixo só mostra campanhas ativas para as quais
				seu perfil possui a capability de processamento local.
			</p>
			{invalidSelection ? (
				<p className={pageStyles.campaignAlert} role="alert">
					A campanha pedida não está disponível ou você não possui acesso a ela.
					Nenhuma outra campanha foi escolhida automaticamente.
				</p>
			) : null}
			{campaigns.length ? (
				<form className={pageStyles.campaignPicker} method="get">
					<label htmlFor="processing-campaign">
						<span>Campanha</span>
						<select id="processing-campaign" name="campanha" required defaultValue="">
							<option value="" disabled>
								Selecione…
							</option>
							{campaigns.map((campaign) => (
								<option key={campaign.technicalSlug} value={campaign.technicalSlug}>
									{campaign.name}
								</option>
							))}
						</select>
					</label>
					<button type="submit">Abrir processamento</button>
				</form>
			) : (
				<div className={pageStyles.campaignEmpty} role="status">
					<strong>Nenhuma campanha ativa disponível para processamento.</strong>
					<span>
						Seu perfil não possui uma campaign ativa com
						{" "}
						<code>{EDIT_CAPABILITIES.localProcess}</code>.
					</span>
				</div>
			)}
			{canManageCampaigns ? (
				<Link
					className={pageStyles.campaignManageLink}
					href="/edit/campanhas?next=%2Fedit%2Fprocessamento"
				>
					Criar ou gerir campanhas
				</Link>
			) : null}
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
			<CampaignPicker
				campaigns={eligible.campaigns}
				invalidSelection={Boolean(requestedCampaign)}
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
			/>
		</section>
	);
}
