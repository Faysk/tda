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

const AUTHENTICATED_STATES = new Set([
	"authenticated_unlinked",
	"authenticated_linked",
	"authenticated_linked_no_grants",
] as const);

export default async function AccountPage({
	searchParams,
}: {
	searchParams: Promise<{ acesso?: string }>;
}) {
	const query = await searchParams;
	const access = await currentAccess();
	const authenticated = AUTHENTICATED_STATES.has(
		access.state as
			| "authenticated_unlinked"
			| "authenticated_linked"
			| "authenticated_linked_no_grants",
	);
	const displayName = authenticated ? access.identity?.displayName ?? null : null;

	const descriptions = {
		anonymous: "Entre com sua conta do Discord para consultar seu vínculo e acesso.",
		unavailable:
			"Não foi possível verificar sua conta agora. Sua sessão pode continuar ativa; tente novamente em instantes.",
		authenticated_unlinked:
			"Você entrou com o Discord, mas sua conta ainda precisa ser vinculada a um perfil da campanha. Fale com a pessoa responsável pela campanha.",
		authenticated_linked_no_grants:
			"Sua conta está vinculada, mas não possui permissões administrativas nesta campanha.",
		authenticated_linked:
			"Sua conta está vinculada. Use o launcher no cabeçalho para abrir diretamente as ferramentas liberadas para você.",
	};

	const accessNotice =
		query.acesso === "negado"
			? "Sua conta não tem acesso à área que você tentou abrir. Escolha outra ferramenta no launcher ou fale com a pessoa responsável pela campanha."
			: query.acesso === "indisponivel"
				? "A área que você tentou abrir não conseguiu verificar seu acesso. Tente novamente em instantes."
				: null;

	return (
		<section className={`${styles.shell} ${styles.accountShell}`}>
			<div className={styles.eyebrow}>TDA · CONTA E ACESSO</div>
			<h1 className={styles.title}>Conta e acesso</h1>

			{displayName ? (
				<p className={styles.description}>
					<strong>{displayName}</strong>
				</p>
			) : null}

			<p className={styles.description} role="status">
				{descriptions[access.state]}
			</p>

			{accessNotice ? (
				<p className={styles.notice} role="alert">
					{accessNotice}
				</p>
			) : null}

			<div className={styles.actions}>
				{access.state === "anonymous" ? (
					<ActionLink href="/entrar" variant="primary">
						Entrar com Discord
					</ActionLink>
				) : access.state === "unavailable" ? (
					<ActionLink href="/conta" variant="secondary">
						Tentar novamente
					</ActionLink>
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
