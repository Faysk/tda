import Image from "next/image";
import { ThemeToggle } from "@/components/theme-toggle";
import { ActionLink, Button } from "@/components/ui";
import type { EditAccessContext } from "@/features/edit/access/policy";
import type { CampaignLifecycle } from "@/features/campaigns/model";
import { AccountCampaignPicker } from "./account-campaign-picker";
import {
	campaignSpecificAccountCapabilityGroups,
	projectAccountCapabilityGroups,
	type AccountCapabilityGroup,
} from "./account-access";
import styles from "./access.module.css";
import { ProfileIdCopy } from "./profile-id-copy";

export type AccountOverviewState =
	| "anonymous"
	| "unavailable"
	| "authenticated_unlinked"
	| "authenticated_linked"
	| "authenticated_linked_no_grants";

export type AccountOverviewAccess = Readonly<{
	state: AccountOverviewState;
	context: EditAccessContext | null;
	identity: Readonly<{
		displayName: string | null;
		avatarUrl: string | null;
	}> | null;
}>;

export type AccountCampaignContext = Readonly<{
	technicalSlug: string;
	name: string;
	lifecycle: CampaignLifecycle;
}>;

const ACCOUNT_STATE_CONTENT = {
	anonymous: {
		label: "Não autenticada",
		description:
			"Entre com o Discord para consultar seu vínculo e seus acessos no TDA.",
	},
	unavailable: {
		label: "Acesso indisponível",
		description:
			"Não foi possível verificar sua conta agora. Sua sessão pode continuar ativa; tente novamente em instantes.",
	},
	authenticated_unlinked: {
		label: "Não vinculada",
		description:
			"Você entrou com o Discord, mas ainda não existe um perfil TDA vinculado a esta conta.",
	},
	authenticated_linked_no_grants: {
		label: "Vinculada · sem permissões",
		description:
			"Seu perfil TDA está vinculado, mas não possui permissões efetivas nas áreas disponíveis.",
	},
	authenticated_linked: {
		label: "Vinculada",
		description:
			"Seu perfil TDA está vinculado. O resumo abaixo separa autoridade do projeto e acesso específico por campanha.",
	},
} as const;

function accountInitials(displayName: string | null) {
	const initials = (displayName ?? "")
		.trim()
		.split(/\s+/u)
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => part.at(0)?.toUpperCase() ?? "")
		.join("");
	return initials || "TDA";
}

function CapabilityGroups({
	groups,
}: Readonly<{ groups: readonly AccountCapabilityGroup[] }>) {
	return (
		<div className={styles.permissionGroups}>
			{groups.map((group) => (
				<details key={group.title} className={styles.permissionGroup}>
					<summary>
						<span>{group.title}</span>
						<span className={styles.permissionCount}>
							{group.items.length}
						</span>
					</summary>
					<ul>
						{group.items.map((item) => (
							<li key={item.capability}>
								<span>{item.label}</span>
							</li>
						))}
					</ul>
				</details>
			))}
		</div>
	);
}

function TechnicalCapabilities({
	groups,
	scope,
}: Readonly<{
	groups: readonly AccountCapabilityGroup[];
	scope: string;
}>) {
	return (
		<details className={styles.technicalDetails}>
			<summary>Detalhes técnicos do acesso</summary>
			<p className={styles.scopeLine}>
				Escopo: <code>{scope}</code>
			</p>
			{groups.length > 0 ? (
				<ul className={styles.technicalCapabilityList}>
					{groups.flatMap((group) =>
						group.items.map((item) => (
							<li key={item.capability}>
								<span>{item.label}</span>
								<code>{item.capability}</code>
							</li>
						)),
					)}
				</ul>
			) : (
				<p className={styles.sectionHint}>
					Nenhuma capability específica neste escopo.
				</p>
			)}
		</details>
	);
}

export function AccountOverview({
	access,
	accessNotice,
	authEnabled,
	campaigns,
	selectedCampaignSlug,
	requestedCampaignUnavailable,
}: Readonly<{
	access: AccountOverviewAccess;
	accessNotice: string | null;
	authEnabled: boolean;
	campaigns: readonly AccountCampaignContext[] | null;
	selectedCampaignSlug: string | null;
	requestedCampaignUnavailable: boolean;
}>) {
	const authenticated =
		access.state === "authenticated_unlinked" ||
		access.state === "authenticated_linked" ||
		access.state === "authenticated_linked_no_grants";
	const displayName = authenticated ? access.identity?.displayName ?? null : null;
	const avatarUrl = authenticated ? access.identity?.avatarUrl ?? null : null;
	const profileId = authenticated ? access.context?.profileId ?? null : null;
	const projectCapabilityGroups = access.context
		? projectAccountCapabilityGroups(access.context)
		: [];
	const campaignContexts =
		campaigns?.map((campaign) => ({
			...campaign,
			capabilityGroups: access.context
				? campaignSpecificAccountCapabilityGroups(
						access.context,
						campaign.technicalSlug,
					)
				: [],
		})) ?? null;
	const selectedCampaign =
		campaignContexts?.find(
			(campaign) => campaign.technicalSlug === selectedCampaignSlug,
		) ?? null;
	const campaignContextCount = campaignContexts?.length ?? 0;
	const singleCampaign =
		campaignContextCount === 1 && campaignContexts ? campaignContexts[0] : null;
	const stateContent = ACCOUNT_STATE_CONTENT[access.state];

	const linkDescription = profileId
		? "Seu perfil TDA está vinculado a esta conta do Discord."
		: access.state === "authenticated_unlinked"
			? "Esta conta do Discord ainda não tem um perfil TDA vinculado. A vinculação continua sendo administrada pela campanha."
			: access.state === "anonymous"
				? "Entre com o Discord para consultar seu vínculo TDA."
				: access.state === "unavailable"
					? "Não foi possível consultar seu vínculo TDA agora."
					: "Nenhum perfil TDA está disponível para esta sessão.";

	return (
		<section className={`${styles.shell} ${styles.accountShell}`} data-layout-family="editorial" data-layout-role="editorial">
			<div className={styles.eyebrow}>TDA · CONTA E ACESSO</div>
			<h1 className={styles.title}>Conta e acesso</h1>

			{accessNotice ? (
				<p className={styles.notice} role="alert">
					{accessNotice}
				</p>
			) : null}

			<header className={styles.accountIdentityHeader}>
				<span className={styles.accountIdentityAvatar} aria-hidden="true">
					{avatarUrl ? (
						<Image src={avatarUrl} alt="" width={64} height={64} sizes="64px" />
					) : (
						<span>{accountInitials(displayName)}</span>
					)}
				</span>
				<div className={styles.accountIdentityCopy}>
					<strong>
						{displayName ?? (authenticated ? "Conta do Discord" : "Visitante")}
					</strong>
					<div className={styles.accountIdentityMeta}>
						<span>{authenticated ? "Discord" : "Discord não conectado"}</span>
						<span className={styles.accountStatus}>{stateContent.label}</span>
					</div>
				</div>
			</header>

			<p className={styles.accountLead} role="status">
				{stateContent.description}
			</p>

			<div className={styles.accountOverviewGrid}>
				<div className={styles.accountRail}>
					<section
						className={styles.accountSection}
						aria-labelledby="tda-identity-title"
					>
						<h2 id="tda-identity-title">Vínculo TDA</h2>
						<p className={styles.sectionHint}>{linkDescription}</p>

						{profileId ? (
							<details className={styles.technicalDetails}>
								<summary>Identificador do perfil</summary>
								<div className={styles.profileIdRow}>
									<code>{profileId}</code>
									<ProfileIdCopy profileId={profileId} />
								</div>
							</details>
						) : null}
					</section>

					<section
						className={styles.accountSection}
						aria-labelledby="appearance-title"
					>
						<h2 id="appearance-title">Aparência</h2>
						<p className={styles.sectionHint}>
							Esta é a mesma preferência de tema disponível no menu global.
						</p>
						<div className={styles.appearanceRow}>
							<span>Modo escuro</span>
							<ThemeToggle />
						</div>
					</section>
				</div>

				<section
					className={styles.permissionsSection}
					aria-labelledby="permissions-title"
				>
					<div className={styles.sectionHeading}>
						<h2 id="permissions-title">Acesso efetivo</h2>
						<p>
							Autoridade do projeto vale transversalmente. Permissões de campanha
							aparecem somente no contexto humano que sua conta pode descobrir.
						</p>
					</div>

					{projectCapabilityGroups.length > 0 ? (
						<section className={styles.accessContext} aria-labelledby="project-access-title">
							<div className={styles.accessContextHeading}>
								<div>
									<span className={styles.contextEyebrow}>Projeto TDA</span>
									<h3 id="project-access-title">Acesso em todo o projeto</h3>
								</div>
								<span className={styles.contextScopeLabel}>Projeto</span>
							</div>
							<p className={styles.sectionHint}>
								Estas permissões são efetivas em campanhas cobertas pelo escopo do projeto.
							</p>
							<CapabilityGroups groups={projectCapabilityGroups} />
							<TechnicalCapabilities groups={projectCapabilityGroups} scope="project/tda" />
						</section>
					) : null}

					{campaignContexts === null ? (
						<p className={styles.notice} role="alert">
							Não foi possível carregar os contextos de campanha agora. Isso não significa
							que suas permissões foram removidas.
						</p>
					) : campaignContextCount > 1 ? (
						<>
							<AccountCampaignPicker
								value={selectedCampaign?.technicalSlug ?? ""}
								options={campaignContexts.map((campaign) => ({
									value: campaign.technicalSlug,
									label: campaign.name,
									lifecycle: campaign.lifecycle,
								}))}
							/>
							{requestedCampaignUnavailable ? (
								<p className={styles.notice} role="status">
									A campanha solicitada não está disponível para esta conta. Escolha um
									contexto autorizado.
								</p>
							) : null}
						</>
					) : null}

					{selectedCampaign ? (
						<details className={styles.accessContext} open>
							<summary className={styles.campaignContextSummary}>
								<span>
									<span className={styles.contextEyebrow}>Campanha</span>
									<strong>{selectedCampaign.name}</strong>
								</span>
								<span className={styles.contextScopeLabel}>
									{selectedCampaign.lifecycle === "archived" ? "Arquivada" : "Ativa"}
								</span>
							</summary>
							<div className={styles.campaignContextBody}>
								<p className={styles.sectionHint}>
									O acesso efetivo combina a autoridade do projeto acima com permissões
									específicas desta campanha.
								</p>
								{selectedCampaign.capabilityGroups.length > 0 ? (
									<CapabilityGroups groups={selectedCampaign.capabilityGroups} />
								) : (
									<p className={styles.emptyState}>
										Nenhuma permissão adicional específica desta campanha.
									</p>
								)}
								<TechnicalCapabilities
									groups={selectedCampaign.capabilityGroups}
									scope={`campaign/${selectedCampaign.technicalSlug}`}
								/>
							</div>
						</details>
					) : campaignContextCount > 1 ? (
						<p className={styles.emptyState}>
							Escolha uma campanha para ver as permissões específicas desse contexto.
						</p>
					) : singleCampaign ? (
						<details className={styles.accessContext} open>
							<summary className={styles.campaignContextSummary}>
								<span>
									<span className={styles.contextEyebrow}>Campanha</span>
									<strong>{singleCampaign.name}</strong>
								</span>
								<span className={styles.contextScopeLabel}>
									{singleCampaign.lifecycle === "archived" ? "Arquivada" : "Ativa"}
								</span>
							</summary>
							<div className={styles.campaignContextBody}>
								{singleCampaign.capabilityGroups.length > 0 ? (
									<CapabilityGroups groups={singleCampaign.capabilityGroups} />
								) : (
									<p className={styles.emptyState}>
										Nenhuma permissão adicional específica desta campanha.
									</p>
								)}
								<TechnicalCapabilities
									groups={singleCampaign.capabilityGroups}
									scope={`campaign/${singleCampaign.technicalSlug}`}
								/>
							</div>
						</details>
					) : projectCapabilityGroups.length === 0 ? (
						<p className={styles.emptyState}>
							{access.state === "authenticated_unlinked"
								? "Vincule um perfil TDA antes de receber permissões."
								: access.state === "anonymous"
									? "Entre com o Discord para consultar seu acesso."
									: access.state === "unavailable"
										? "Não foi possível calcular seu acesso agora."
										: "Nenhuma permissão efetiva encontrada."}
						</p>
					) : null}
				</section>
			</div>

			<section className={styles.accountSession} aria-labelledby="session-title">
				<div>
					<h2 id="session-title">Sessão</h2>
					<p className={styles.sectionHint}>
						{authenticated
							? "Autenticado com Discord."
							: access.state === "anonymous"
								? "Nenhuma sessão autenticada."
								: "Não foi possível confirmar o estado da sessão."}
					</p>
				</div>
				<div className={styles.sessionActions}>
					{access.state === "anonymous" ? (
						<ActionLink href="/entrar" variant="primary">
							Entrar com Discord
						</ActionLink>
					) : access.state === "unavailable" ? (
						<ActionLink href="/conta" variant="secondary">
							Tentar novamente
						</ActionLink>
					) : authEnabled && authenticated ? (
						<form action="/auth/logout" method="post">
							<Button type="submit" variant="secondary">
								Sair da conta
							</Button>
						</form>
					) : null}
				</div>
			</section>
		</section>
	);
}
