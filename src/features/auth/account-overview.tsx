import Image from "next/image";
import { OperationalPageHeader } from "@/components/operational-page-header";
import { ThemeToggle } from "@/components/theme-toggle";
import { ActionLink, Button } from "@/components/ui";
import type { EditAccessContext } from "@/features/edit/access/policy";
import type { AccountCampaignAccess } from "./account-campaign-access";
import { AccountCampaignPicker } from "./account-campaign-picker";
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

const ACCOUNT_STATE_CONTENT = {
	anonymous: {
		label: "Não autenticada",
		description:
			"Entre com o Discord para consultar seu vínculo e seu acesso às campanhas.",
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
			"Seu perfil TDA está vinculado, mas não possui permissões efetivas ativas no momento.",
	},
	authenticated_linked: {
		label: "Vinculada",
		description:
			"Seu perfil TDA está vinculado. O acesso abaixo identifica a campanha consultada e de onde cada permissão vem.",
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

function campaignScopeSummary(
	projectCapabilityCount: number,
	campaignCapabilityCount: number,
) {
	if (projectCapabilityCount > 0 && campaignCapabilityCount > 0) {
		return "Parte do acesso é herdada do projeto TDA e parte é específica desta campanha.";
	}
	if (projectCapabilityCount > 0) {
		return "Este acesso é herdado do projeto TDA e vale para esta campanha enquanto os grants do projeto estiverem ativos.";
	}
	return "Este acesso é específico desta campanha.";
}

export function AccountOverview({
	access,
	campaignAccess,
	accessNotice,
	deniedReturnTo,
	authEnabled,
}: Readonly<{
	access: AccountOverviewAccess;
	campaignAccess: AccountCampaignAccess;
	accessNotice: string | null;
	deniedReturnTo?: string | null;
	authEnabled: boolean;
}>) {
	const authenticated =
		access.state === "authenticated_unlinked" ||
		access.state === "authenticated_linked" ||
		access.state === "authenticated_linked_no_grants";
	const displayName = authenticated ? access.identity?.displayName ?? null : null;
	const avatarUrl = authenticated ? access.identity?.avatarUrl ?? null : null;
	const profileId = authenticated ? access.context?.profileId ?? null : null;
	const selectedCampaign =
		campaignAccess.state === "ready" ? campaignAccess.selectedCampaign : null;
	const capabilityGroups = selectedCampaign?.capabilityGroups ?? [];
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
		<section
			className={`${styles.shell} ${styles.accountShell}`}
			data-layout-family="editorial"
			data-layout-role="editorial"
		>
			<OperationalPageHeader eyebrow="Conta" title="Conta e acesso" />

			{accessNotice ? (
				<>
					<p className={styles.notice} role="alert">
						{accessNotice}
					</p>
					{deniedReturnTo ? (
						<div className={styles.sessionActions}>
							<ActionLink href={deniedReturnTo} variant="secondary">
								Tentar abrir novamente
							</ActionLink>
						</div>
					) : null}
				</>
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
						<h2 id="permissions-title">Acesso por campanha</h2>
						<p>
							Escolha o contexto que deseja consultar. Permissões herdadas do projeto
							e permissões específicas da campanha continuam sendo verificadas no
							servidor a cada ação.
						</p>
					</div>

					{campaignAccess.state === "unavailable" ? (
						<p className={styles.accessUnavailable} role="alert">
							Não foi possível verificar agora quais campanhas esta conta pode
							consultar. Isso não significa que você esteja sem permissão; tente
							novamente.
						</p>
					) : campaignAccess.campaigns.length > 1 ? (
						<div className={styles.campaignPicker}>
							<span>Campanha consultada</span>
							<AccountCampaignPicker
								campaigns={campaignAccess.campaigns}
								selectedCampaignSlug={selectedCampaign?.technicalSlug ?? null}
							/>
						</div>
					) : null}

					{campaignAccess.state === "ready" &&
					campaignAccess.requestedCampaignUnavailable ? (
						<p className={styles.campaignSelectionNotice} role="status">
							A campanha solicitada não está disponível para esta conta. Escolha uma
							campanha autorizada.
						</p>
					) : null}

					{selectedCampaign ? (
						<>
							<div
								className={styles.campaignAccessSummary}
								data-account-campaign-summary="true"
							>
								<div>
									<span>Campanha consultada</span>
									<strong>{selectedCampaign.name}</strong>
								</div>
								<p>
									{campaignScopeSummary(
										selectedCampaign.projectCapabilityCount,
										selectedCampaign.campaignCapabilityCount,
									)}
								</p>
							</div>

							{capabilityGroups.length > 0 ? (
								<div className={styles.permissionGroups}>
									{capabilityGroups.map((group) => (
										<details
											key={group.title}
											className={styles.permissionGroup}
										>
											<summary>
												<span>{group.title}</span>
												<small>
													{group.items.length}{" "}
													{group.items.length === 1 ? "permissão" : "permissões"}
												</small>
											</summary>
											<ul>
												{group.items.map((item) => (
													<li key={item.capability}>
														<span>{item.label}</span>
														<small className={styles.permissionScope}>
															{item.scope === "project"
																? "Herdada do projeto TDA"
																: "Específica desta campanha"}
														</small>
													</li>
												))}
											</ul>
										</details>
									))}
								</div>
							) : (
								<p className={styles.emptyState}>
									Nenhuma permissão efetiva nesta campanha.
								</p>
							)}

							<details className={styles.technicalDetails}>
								<summary>Detalhes técnicos do acesso</summary>
								<p className={styles.scopeLine}>
									Campanha: <code>{selectedCampaign.technicalSlug}</code>
								</p>
								<p className={styles.sectionHint}>
									As capabilities abaixo são informativas; elas não tornam o
									cliente autoridade de acesso.
								</p>
								<ul className={styles.technicalCapabilityList}>
									{capabilityGroups.flatMap((group) =>
										group.items.map((item) => (
											<li key={item.capability}>
												<span>{item.label}</span>
												<code>{item.capability}</code>
											</li>
										)),
									)}
								</ul>
							</details>
						</>
					) : campaignAccess.state === "ready" &&
					campaignAccess.campaigns.length === 0 ? (
						<p className={styles.emptyState}>
							{access.state === "authenticated_linked_no_grants"
								? "Nenhuma permissão efetiva está ativa para esta conta."
								: access.state === "authenticated_unlinked"
									? "Vincule um perfil TDA antes de receber permissões de campanha."
									: access.state === "anonymous"
										? "Entre com o Discord para consultar seu acesso."
										: "Nenhuma campanha com acesso efetivo foi encontrada para esta conta."}
						</p>
					) : campaignAccess.state === "ready" &&
					campaignAccess.campaigns.length > 1 ? (
						<p className={styles.emptyState}>
							Escolha uma campanha para ver as permissões efetivas nesse contexto.
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
