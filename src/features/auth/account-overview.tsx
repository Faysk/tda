import Image from "next/image";
import { OperationalPageHeader } from "@/components/operational-page-header";
import { ThemeToggle } from "@/components/theme-toggle";
import { ActionLink, Button } from "@/components/ui";
import type { EditAccessContext } from "@/features/edit/access/policy";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";
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
		label: "Vinculada · sem permissões",
		description:
			"Seu perfil TDA está vinculado, mas não possui permissões efetivas nesta campanha.",
	},
	authenticated_linked: {
		label: "Vinculada",
		description:
			"Seu perfil TDA está vinculado e o acesso abaixo reflete as permissões efetivas desta campanha.",
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
						<h2 id="permissions-title">Acesso nesta campanha</h2>
						<p>
							Aqui aparecem apenas permissões efetivas. A autorização continua
							sendo verificada no servidor quando você abre ou executa uma ação.
						</p>
					</div>

					{capabilityGroups.length > 0 ? (
						<>
							<div className={styles.permissionGroups}>
								{capabilityGroups.map((group) => (
									<section key={group.title} className={styles.permissionGroup}>
										<h3>{group.title}</h3>
										<ul>
											{group.items.map((item) => (
												<li key={item.capability}>
													<span>{item.label}</span>
												</li>
											))}
										</ul>
									</section>
								))}
							</div>

							<details className={styles.technicalDetails}>
								<summary>Detalhes técnicos do acesso</summary>
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
					) : (
						<p className={styles.emptyState}>
							{access.state === "authenticated_linked_no_grants"
								? "Nenhuma permissão efetiva nesta campanha."
								: access.state === "authenticated_unlinked"
									? "Vincule um perfil TDA antes de receber permissões da campanha."
									: access.state === "anonymous"
										? "Entre com o Discord para consultar seu acesso."
										: access.state === "unavailable"
											? "Não foi possível calcular seu acesso agora."
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
