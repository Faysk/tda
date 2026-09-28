import type { Metadata } from "next";
import { PublicLink as Link } from "@/components/public-link";
import { ActionLink, Button } from "@/components/ui";
import { authConfig } from "@/features/auth/config";
import { currentAccess } from "@/features/auth/server";
import styles from "@/features/auth/access.module.css";

export const metadata: Metadata = {
	title: "Conta e acesso",
	robots: { index: false, follow: false },
};

export default async function AccountPage({
	searchParams,
}: {
	searchParams: Promise<{ acesso?: string }>;
}) {
	const query = await searchParams;
	const access = await currentAccess();
	const authenticated = access.state.startsWith("authenticated_");
	const displayName = authenticated
		? access.identity?.displayName ?? "Conta conectada"
		: null;

	const descriptions = {
		anonymous: "Entre com sua conta do Discord para consultar seu vínculo e acesso.",
		unavailable:
			"Não foi possível verificar sua conta e seu acesso agora. Tente novamente em instantes.",
		authenticated_unlinked:
			"Sua conta do Discord está conectada, mas ainda precisa ser vinculada a um perfil da campanha.",
		authenticated_linked_no_grants:
			"Sua conta está vinculada a um perfil da campanha, mas não possui permissões administrativas ativas.",
		authenticated_linked:
			"Sua conta está vinculada e possui acesso configurado para esta campanha.",
	} as const;

	const accessStateLabel =
		access.state === "authenticated_unlinked"
			? "Perfil da campanha não vinculado"
			: access.state === "authenticated_linked_no_grants"
				? "Sem permissões administrativas ativas"
				: access.state === "authenticated_linked"
					? "Conta vinculada"
					: null;

	const accessNotice =
		query.acesso === "negado"
			? "Sua conta não tem acesso à área que você tentou abrir. Consulte seu vínculo e suas permissões abaixo."
			: query.acesso === "indisponivel"
				? "A área que você tentou abrir não conseguiu verificar seu acesso. Tente novamente em instantes."
				: null;

	return (
		<section className={`${styles.shell} ${styles.accountShell}`}>
			<div className={styles.eyebrow}>TDA · SUA CONTA</div>
			<h1 className={styles.title}>Conta e acesso</h1>
			<p className={styles.description} role="status">
				{descriptions[access.state]}
			</p>

			{accessNotice ? (
				<p className={styles.notice} role="alert">
					{accessNotice}
				</p>
			) : null}

			{authenticated ? (
				<section className={styles.accountIdentity} aria-label="Identidade e acesso">
					<span className={styles.accountIdentityLabel}>Discord</span>
					<strong>{displayName}</strong>
					<span className={styles.accountIdentityState}>
						{accessStateLabel}
					</span>
				</section>
			) : null}

			<div className={styles.actions}>
				{access.state === "anonymous" ? (
					<ActionLink href="/entrar" variant="primary">
						Entrar com Discord
					</ActionLink>
				) : null}
				{access.state === "unavailable" ? (
					<Link href="/conta">Tentar novamente</Link>
				) : null}
				<Link href="/sessoes">Ver histórias públicas</Link>
			</div>

			<div className={styles.accountSession}>
				{authConfig() && authenticated ? (
					<form action="/auth/logout" method="post">
						<Button type="submit">Sair da conta</Button>
					</form>
				) : null}
			</div>
		</section>
	);
}
