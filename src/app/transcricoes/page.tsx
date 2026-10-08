import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OperationalPageHeader } from "@/components/operational-page-header";
import { PublicLink as Link } from "@/components/public-link";
import { currentAccess } from "@/features/auth/server";
import {
	readAuthorizedCampaignRoutes,
	resolveAuthorizedCampaignReference,
	type AuthorizedCampaignRoute,
} from "@/features/campaigns/authorized-routes";
import { CampaignRoutePicker } from "@/features/campaigns/campaign-route-picker";
import { canManageCampaignRegistry } from "@/features/campaigns/policy";
import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
} from "@/features/edit/access/policy";
import { TranscriptInventory } from "@/features/transcripts/statistics/inventory";
import {
	formatDuration,
	formatWords,
	transcriptCoverageState,
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

function transcriptSelectionHref(campaignSlug: string) {
	return `/transcricoes?campanha=${encodeURIComponent(campaignSlug)}`;
}

function TranscriptCampaignPicker({
	campaigns,
	selected,
	invalidSelection = false,
	canManageCampaigns = false,
}: Readonly<{
	campaigns: readonly AuthorizedCampaignRoute[];
	selected?: string;
	invalidSelection?: boolean;
	canManageCampaigns?: boolean;
}>) {
	const currentHref = selected ? transcriptSelectionHref(selected) : "/transcricoes";
	const manageHref = canManageCampaigns
		? `/edit/campanhas?next=${encodeURIComponent(currentHref)}`
		: undefined;

	return (
		<div className={styles.campaignContext}>
			{invalidSelection ? (
				<p className={styles.campaignAlert} role="alert">
					A campanha pedida não está disponível neste contexto. Ela pode não
					existir, estar fora do seu acesso ou não estar mais disponível.
					Nenhuma outra campanha foi escolhida automaticamente.
				</p>
			) : null}
			<CampaignRoutePicker
				ariaLabel="Campanha das transcrições"
				label="Campanha"
				behavior="confirmed"
				confirmLabel={selected ? "Trocar campanha" : "Abrir transcrições"}
				pendingLabel="Abrindo transcrições…"
				value={selected ?? ""}
				options={campaigns.map((campaign) => ({
					value: campaign.technicalSlug,
					label: campaign.name,
					lifecycle: campaign.lifecycle,
					disabled: false,
					href: transcriptsHref(campaign.routeKey),
				}))}
				canManage={canManageCampaigns}
				manageHref={manageHref}
			/>
		</div>
	);
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

	const eligible = await readAuthorizedCampaignRoutes(
		access.context,
		EDIT_CAPABILITIES.transcriptRead,
		{ includeArchived: true },
	);
	const canManageCampaigns = canManageCampaignRegistry(access.context);
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

	if (!eligible.campaigns.length) {
		return (
			<AccessState
				title="Nenhuma campanha disponível"
				message="Seu perfil não possui acesso de leitura de transcrições em nenhuma campanha disponível."
				href="/conta"
				label="Consultar meu acesso"
			/>
		);
	}

	if (!requestedCampaign && eligible.campaigns.length === 1) {
		redirect(transcriptsHref(eligible.campaigns[0]!.routeKey));
	}

	const selected = requestedCampaign
		? resolveAuthorizedCampaignReference(eligible.campaigns, requestedCampaign)
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
				<TranscriptCampaignPicker
					campaigns={eligible.campaigns}
					invalidSelection={Boolean(requestedCampaign)}
					canManageCampaigns={canManageCampaigns}
				/>
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
				<TranscriptCampaignPicker
					campaigns={eligible.campaigns}
					selected={selected.technicalSlug}
					canManageCampaigns={canManageCampaigns}
				/>
				<p role="status">{message}</p>
				<p className={styles.accountLink}>
					<Link href="/conta">Consultar meu acesso</Link>
				</p>
			</section>
		);
	}

	const { sessions, totals } = result.value;
	const hasInventory = sessions.length > 0;
	const coverageState = transcriptCoverageState(totals);
	const canProcess = authorizeCampaignCapability(
		access.context,
		EDIT_CAPABILITIES.localProcess,
		selected.technicalSlug,
	).ok;

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

			<TranscriptCampaignPicker
				campaigns={eligible.campaigns}
				selected={selected.technicalSlug}
				canManageCampaigns={canManageCampaigns}
			/>

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
				{coverageState === "empty" ? (
					<p role="status" className={styles.coverageNotice}>
						Sem sessões no inventário: ainda não há cobertura para avaliar.
					</p>
				) : coverageState === "incomplete" ? (
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

			{hasInventory ? (
				<TranscriptInventory sessions={sessions} />
			) : (
				<div className={styles.emptyState} role="status">
					<strong>Nenhuma transcrição nesta campanha ainda.</strong>
					<span>
						O inventário está vazio; isso não significa cobertura completa nem
						ausência definitiva de sessões.
					</span>
					{canProcess ? (
						<Link
							href={`/edit/${encodeURIComponent(selected.routeKey)}/processamento`}
						>
							Abrir processamento
						</Link>
					) : (
						<span>
							Quando uma transcrição autorizada estiver disponível, ela aparecerá
							aqui.
						</span>
					)}
				</div>
			)}

			<p className={styles.accountLink}>
				<Link href="/conta">Minha conta</Link>
			</p>
		</section>
	);
}
