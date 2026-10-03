import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OperationalPageHeader } from "@/components/operational-page-header";
import { PublicLink as Link } from "@/components/public-link";
import { currentAccess } from "@/features/auth/server";
import { CampaignRoutePicker } from "@/features/campaigns/campaign-picker";
import { campaignManagementHref } from "@/features/campaigns/entrypoints";
import { canManageCampaignRegistry } from "@/features/campaigns/policy";
import {
	readAuthorizedCampaigns,
	type AuthorizedCampaign,
} from "@/features/campaigns/authorized";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import { TranscriptInventory } from "@/features/transcripts/statistics/inventory";
import {
	formatDuration,
	formatWords,
} from "@/features/transcripts/statistics/model";
import { getTranscriptStatistics } from "@/features/transcripts/statistics/server";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const metadata: Metadata = {
	title: "Transcrições",
	robots: { index: false, follow: false },
};

type SearchParams = Promise<
	Readonly<{
		campanha?: string | string[];
	}>
>;

function first(value: string | string[] | undefined) {
	return Array.isArray(value) ? value[0] : value;
}

function transcriptsHref(campaignSlug: string) {
	return `/edit/${encodeURIComponent(campaignSlug)}/transcricoes`;
}

function AccessState({
	title,
	message,
	href,
	label,
}: Readonly<{
	title: string;
	message: string;
	href?: string;
	label?: string;
}>) {
	return (
		<section
			className={styles.shell}
			data-layout-family="workspace"
			data-layout-role="editorial"
		>
			<OperationalPageHeader eyebrow="Transcrições" title={title} />
			<p role="status">{message}</p>
			{href && label ? <Link href={href}>{label}</Link> : null}
		</section>
	);
}

export default async function TranscriptsPage({
	searchParams,
}: {
	searchParams: SearchParams;
}) {
	const params = await searchParams;
	const requestedCampaign = first(params.campanha);
	const nextPath = requestedCampaign
		? transcriptsHref(requestedCampaign)
		: "/transcricoes";
	const access = await currentAccess();

	if (access.state === "anonymous") {
		return (
			<AccessState
				title="Transcrições"
				message="Entre com sua conta do Discord para consultar as transcrições das campanhas disponíveis para o seu perfil."
				href={"/entrar?next=" + encodeURIComponent(nextPath)}
				label="Entrar"
			/>
		);
	}
	if (access.state === "unavailable") {
		return (
			<AccessState
				title="Transcrições indisponíveis"
				message="Não foi possível verificar seu acesso agora. Nenhuma campanha privada foi consultada."
				href="/conta"
				label="Minha conta"
			/>
		);
	}
	if (!access.context?.profileId) {
		return (
			<AccessState
				title="Acesso não vinculado"
				message="Sua conta está autenticada, mas ainda não está vinculada a um perfil com acesso a campanhas."
				href="/conta"
				label="Consultar meu acesso"
			/>
		);
	}

	const eligible = await readAuthorizedCampaigns(
		access.context,
		EDIT_CAPABILITIES.transcriptRead,
		{ includeArchived: true },
	);
	if (!eligible.ok) {
		return (
			<AccessState
				title="Transcrições indisponíveis"
				message="O diretório autorizado de campanhas não pôde ser consultado com segurança. Nenhum contexto foi assumido."
				href="/conta"
				label="Minha conta"
			/>
		);
	}

	const canManageCampaigns = canManageCampaignRegistry(access.context);
	const campaignChoices = eligible.campaigns.map((campaign) => ({
		value: campaign.technicalSlug,
		label: campaign.name,
		lifecycle: campaign.lifecycle,
		href: transcriptsHref(campaign.technicalSlug),
	}));

	if (!eligible.campaigns.length) {
		return (
			<AccessState
				title="Nenhuma campanha disponível"
				message="Seu perfil não possui acesso de leitura de transcrições em nenhuma campanha disponível."
				href={
					canManageCampaigns
						? campaignManagementHref("/transcricoes")
						: "/conta"
				}
				label={canManageCampaigns ? "Gerir campanhas" : "Consultar meu acesso"}
			/>
		);
	}

	if (!requestedCampaign && eligible.campaigns.length === 1) {
		redirect(transcriptsHref(eligible.campaigns[0]!.technicalSlug));
	}

	const selected = requestedCampaign
		? eligible.campaigns.find(
				(campaign) => campaign.technicalSlug === requestedCampaign,
			) ?? null
		: null;

	if (!selected) {
		return (
			<section
				className={styles.shell}
				data-layout-family="workspace"
				data-layout-role="editorial"
			>
				<OperationalPageHeader
					eyebrow="Transcrições"
					title="Escolha a campanha"
					description={
						<p>
							As estatísticas são privadas e sempre calculadas dentro de uma
							campanha autorizada.
						</p>
					}
				/>
				{requestedCampaign ? (
					<p className={styles.campaignAlert} role="alert">
						A campanha pedida não está disponível neste contexto. Nenhuma outra
						campanha foi escolhida automaticamente.
					</p>
				) : null}
				<div className={styles.campaignContext}>
					<CampaignRoutePicker
						actionLabel="Abrir transcrições"
						ariaLabel="Campanha das transcrições"
						behavior="confirm"
						currentValue={undefined}
						manageAction={
							canManageCampaigns
								? {
										label: "Gerir campanhas",
										href: campaignManagementHref("/transcricoes"),
									}
								: undefined
						}
						options={campaignChoices}
					/>
				</div>
			</section>
		);
	}

	const result = await getTranscriptStatistics(selected.technicalSlug);
	if (!result.ok) {
		const message =
			result.reason === "dependency_unavailable"
				? "Não foi possível consultar as transcrições agora. Nenhum resultado parcial foi exibido."
				: result.reason === "profile_unresolved"
					? "Seu vínculo de perfil mudou desde a abertura desta página."
					: result.reason === "validation"
						? "O contexto de campanha não pôde ser validado."
						: "Seu acesso a esta campanha mudou desde a abertura da página. Atualize a seleção antes de continuar.";
		return (
			<section
				className={styles.shell}
				data-layout-family="workspace"
				data-layout-role="editorial"
			>
				<OperationalPageHeader
					eyebrow="Transcrições"
					title={selected.name}
				/>
				<div className={styles.campaignContext}>
					<CampaignRoutePicker
						actionLabel="Trocar campanha"
						ariaLabel="Campanha das transcrições"
						behavior="confirm"
						currentValue={selected.technicalSlug}
						manageAction={
							canManageCampaigns
								? {
										label: "Gerir campanhas",
										href: campaignManagementHref(
											transcriptsHref(selected.technicalSlug),
										),
									}
								: undefined
						}
						options={campaignChoices}
					/>
				</div>
				<p role="status">{message}</p>
				<p className={styles.accountLink}>
					<Link href="/conta">Consultar meu acesso</Link>
				</p>
			</section>
		);
	}

	const { sessions, totals } = result.value;
	const coverageIncomplete =
		totals.wordCoverage < totals.sessions ||
		totals.durationCoverage < totals.sessions;

	return (
		<section
			className={styles.shell}
			data-layout-family="workspace"
			data-layout-role="editorial"
		>
			<OperationalPageHeader
				eyebrow="Transcrições"
				title={selected.name}
				description={
					<p>
						Estatísticas e inventário da campanha selecionada.
						{selected.lifecycle === "archived"
							? " Esta campanha está arquivada e permanece disponível para leitura histórica autorizada."
							: ""}
					</p>
				}
			/>

			<div className={styles.campaignContext}>
				<CampaignRoutePicker
					actionLabel="Trocar campanha"
					ariaLabel="Campanha das transcrições"
					behavior="confirm"
					currentValue={selected.technicalSlug}
					manageAction={
						canManageCampaigns
							? {
									label: "Gerir campanhas",
									href: campaignManagementHref(
										transcriptsHref(selected.technicalSlug),
									),
								}
							: undefined
					}
					options={campaignChoices}
				/>
			</div>

			<dl
				className={styles.summaryStrip}
				aria-label={`Resumo das transcrições — ${selected.name}`}
			>
				<div>
					<dt>Sessões</dt>
					<dd>{sessions.length}</dd>
				</div>
				<div>
					<dt>Palavras</dt>
					<dd>{formatWords(totals.words)}</dd>
				</div>
				<div>
					<dt>Duração registrada</dt>
					<dd>{formatDuration(totals.durationMs)}</dd>
				</div>
				<div>
					<dt>Cobertura</dt>
					<dd>
						Palavras {totals.wordCoverage}/{totals.sessions} · duração{" "}
						{totals.durationCoverage}/{totals.sessions}
					</dd>
				</div>
			</dl>

			<div className={styles.metricRow}>
				{coverageIncomplete ? (
					<p role="status" className={styles.coverageNotice}>
						Cobertura incompleta: ausência de dados não significa zero.
					</p>
				) : (
					<p className={styles.coverageComplete}>Cobertura completa.</p>
				)}
				<details className={styles.metricDetails}>
					<summary>Como é calculado?</summary>
					<p>
						Palavras do texto atual, separadas por espaços. Duração registrada
						da sessão; não é soma de falantes, tempo de fala ou estimativa de
						leitura.
					</p>
				</details>
			</div>

			{sessions.length ? (
				<TranscriptInventory sessions={sessions} />
			) : (
				<p className={styles.emptyState}>
					Nenhuma sessão disponível nesta campanha.
				</p>
			)}

			<p className={styles.accountLink}>
				<Link href="/conta">Minha conta</Link>
			</p>
		</section>
	);
}
