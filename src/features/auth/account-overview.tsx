import Image from "next/image";
import { OperationalPageHeader } from "@/components/operational-page-header";
import { ThemeToggle } from "@/components/theme-toggle";
import { ActionLink, Button } from "@/components/ui";
import type { EditAccessContext } from "@/features/edit/access/policy";
import {
	effectiveAccountProjectCapabilityGroups,
	type AccountCapabilityGroup,
} from "./account-access";
import type {
	AccountCampaignAccess,
	AccountCampaignAccessResult,
} from "./account-campaigns";
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
			"Entre com o Discord para consultar seu vínculo e os acessos disponíveis para esta conta.",
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
			"Seu perfil TDA está vinculado, mas não possui grants ativos para as áreas protegidas.",
	},
	authenticated_linked: {
		label: "Vinculada",
		description:
			"Seu perfil TDA está vinculado. O acesso abaixo separa autoridade do projeto de permissões específicas de campanha.",
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

function PermissionGroups({
	groups,
}: Readonly<{ groups: readonly AccountCapabilityGroup[] }>) {
	return (
		<div className={styles.permissionGroups}>
			{groups.map((group) => (
				<details key={group.title} className={styles.permissionGroupDetails}>
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
							</li>
						))}
					</ul>
				</details>
			))}
		</div>
	);
}

function TechnicalScopeDetails({
	scope,
	groups,
}: Readonly<{
	scope: string;
	groups: readonly AccountCapabilityGroup[];
}>) {
	return (
		<details className={styles.technicalDetails}>
			<summary>Detalhes técnicos do acesso</summary>
			<p className={styles.scopeLine}>
				Escopo: <code>{scope}</code>
			</p>
			<p className={styles.sectionHint}>
				As capabilities abaixo são informativas; o servidor continua sendo a
				autoridade de acesso.
			</p>
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
		</details>
	);
}

function CampaignAccessBlock({
	campaign,
}: Readonly<{ campaign: AccountCampaignAccess }>) {
	return (
		<section className={styles.accessScopeBlock}>
			<div className={styles.accessScopeHeading}>
				<div>
					<h3>{campaign.name}</h3>
					<p>
						Acesso concedido especificamente nesta campanha. Permissões já
						cobertas pela autoridade do projeto não são repetidas aqui.
					</p>
				</div>
				{campaign.lifecycle === "archived" ? (
					<span className={styles.scopeState}>Arquivada</span>
				) : null}
			</div>
			<PermissionGroups groups={campaign.capabilityGroups} />
			<TechnicalScopeDetails
				scope={`campaign/${campaign.technicalSlug}`}
				groups={campaign.capabilityGroups}
			/>
		</section>
	);
}

export function AccountOverview({
	access,
	campaignAccess,
	accessNotice,
	authEnabled,
}: Readonly<{
	access: AccountOverviewAccess;
	campaignAccess: AccountCampaignAccessResult;
	accessNotice: string | null;
	authEnabled: boolean;
}>) {
	const authenticated =
		access.state === "authenticated_unlinked" ||
		access.state === "authenticated_linked" ||
		access.state === "authenticated_linked_no_grants";
	const displayName = authenticated ? access.identity?.displayName ?? null : null;
	const avatarUrl = authenticated ? access.identity?.avatarUrl ?? null : null;
	const profileId = authenticated ? access.context?.profileId ?? null : null;
	const projectCapabilityGroups =
		access.context?.profileId
			? effectiveAccountProjectCapabilityGroups(access.context)
			: [];
	const stateContent = ACCOUNT_STATE_CONTENT[access.state];
	const campaignAccessUnavailable = campaignAccess.status === "unavailable";
	const hasVisibleAccess =
		projectCapabilityGroups.length > 0 ||
		(campaignAccess.status === "ready" && campaignAccess.campaigns.length > 0);

	const linkDescription = profileId
		? "Seu perfil TDA está vinculado a esta conta do Discord."
		: access.state === "authenticated_unlinked"
			? "Esta conta do Discord ainda não tem um perfil TDA vinculado. A vinculação continua sendo administrada pelo projeto."
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
							O contexto é explícito: autoridade do projeto e grants específicos
							de campanha aparecem separados. Cada ação continua sendo
							revalidada no servidor.
						</p>
					</div>

					{campaignAccessUnavailable ? (
						<p className={styles.accessUnavailable} role="status">
							Não foi possível carregar o diretório autorizado de campanhas
							agora. Seus grants não foram reinterpretados como ausência de
							permissão; recarregue para tentar novamente.
						</p>
					) : null}

					{projectCapabilityGroups.length > 0 ? (
						<section className={styles.accessScopeBlock}>
							<div className={styles.accessScopeHeading}>
								<div>
									<h3>Autoridade do projeto</h3>
									<p>
										Estas permissões valem em nível de projeto para a mesma
										capability, sem transformar a interface em autoridade.
									</p>
								</div>
							</div>
							<PermissionGroups groups={projectCapabilityGroups} />
							<TechnicalScopeDetails
								scope="project/tda"
								groups={projectCapabilityGroups}
							/>
						</section>
					) : null}

					{campaignAccess.status === "ready"
						? campaignAccess.campaigns.map((campaign) => (
								<CampaignAccessBlock
									key={campaign.technicalSlug}
									campaign={campaign}
								/>
							))
						: null}

					{!campaignAccessUnavailable && !hasVisibleAccess ? (
						<p className={styles.emptyState}>
							{access.state === "authenticated_unlinked"
								? "Vincule um perfil TDA antes de receber permissões."
								: access.state === "anonymous"
									? "Entre com o Discord para consultar seu acesso."
									: access.state === "unavailable"
										? "Não foi possível calcular seu acesso agora."
										: "Nenhuma permissão efetiva disponível para esta conta."}
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
