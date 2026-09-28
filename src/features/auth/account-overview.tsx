import Image from "next/image";
import { ThemeToggle } from "@/components/theme-toggle";
import { ActionLink, Button } from "@/components/ui";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import type { EditAccessContext } from "@/features/edit/access/policy";
import { effectiveAccountCapabilityGroups } from "./account-access";
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
			"Entre com o Discord para consultar seu vínculo e suas permissões nesta campanha.",
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
		label: "Sem permissões nesta campanha",
		description:
			"Seu perfil TDA está vinculado, mas não possui permissões efetivas nesta campanha.",
	},
	authenticated_linked: {
		label: "Vinculada",
		description:
			"Seu perfil TDA está vinculado e as permissões abaixo refletem o acesso efetivo desta campanha.",
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

export function AccountOverview({
	access,
	accessNotice,
	authEnabled,
}: Readonly<{
	access: AccountOverviewAccess;
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
	const capabilityGroups =
		access.context?.profileId
			? effectiveAccountCapabilityGroups(access.context, CAMPAIGN_SLUG)
			: [];
	const stateContent = ACCOUNT_STATE_CONTENT[access.state];

	return (
		<section className={`${styles.shell} ${styles.accountShell}`}>
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
					<strong>{displayName ?? (authenticated ? "Conta do Discord" : "Visitante")}</strong>
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
					<section className={styles.accountSection} aria-labelledby="tda-identity-title">
						<h2 id="tda-identity-title">Identidade TDA</h2>
						{profileId ? (
							<>
								<p className={styles.sectionHint}>
									Este é o identificador do seu perfil dentro do TDA.
								</p>
								<div className={styles.profileIdRow}>
									<code>{profileId}</code>
									<ProfileIdCopy profileId={profileId} />
								</div>
							</>
						) : (
							<p className={styles.emptyState}>
								{access.state === "authenticated_unlinked"
									? "Ainda sem perfil TDA vinculado. A vinculação continua sendo feita pelo fluxo administrado da campanha."
									: access.state === "anonymous"
										? "Entre com o Discord para consultar seu perfil TDA."
										: access.state === "unavailable"
											? "Não foi possível consultar seu perfil TDA agora."
											: "Nenhum perfil TDA disponível para esta sessão."}
							</p>
						)}
					</section>

					<section className={styles.accountSection} aria-labelledby="appearance-title">
						<h2 id="appearance-title">Aparência</h2>
						<p className={styles.sectionHint}>
							Use a mesma preferência de tema disponível no menu da conta.
						</p>
						<div className={styles.appearanceRow}>
							<span>Modo escuro</span>
							<ThemeToggle />
						</div>
					</section>
				</div>

				<section className={styles.permissionsSection} aria-labelledby="permissions-title">
					<div className={styles.sectionHeading}>
						<h2 id="permissions-title">Permissões nesta campanha</h2>
						<p>
							Somente capabilities efetivas agora aparecem aqui. Grants crus,
							expirados ou revogados não são exibidos.
						</p>
					</div>

					{capabilityGroups.length > 0 ? (
						<div className={styles.permissionGroups}>
							{capabilityGroups.map((group) => (
								<section key={group.title} className={styles.permissionGroup}>
									<h3>{group.title}</h3>
									<ul>
										{group.items.map((item) => (
											<li key={item.capability}>
												<span>{item.label}</span>
												<code>{item.capability}</code>
											</li>
										))}
									</ul>
								</section>
							))}
						</div>
					) : (
						<p className={styles.emptyState}>
							{access.state === "authenticated_linked_no_grants"
								? "Nenhuma permissão efetiva nesta campanha."
								: access.state === "authenticated_unlinked"
									? "Vincule um perfil TDA antes de receber permissões da campanha."
									: access.state === "anonymous"
										? "Entre com o Discord para consultar suas permissões."
										: access.state === "unavailable"
											? "Não foi possível calcular suas permissões agora."
											: "Nenhuma permissão efetiva nesta campanha."}
						</p>
					)}
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
							<Button type="submit">Sair da conta</Button>
						</form>
					) : null}
				</div>
			</section>
		</section>
	);
}
