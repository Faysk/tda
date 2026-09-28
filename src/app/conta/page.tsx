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

function isAuthenticatedState(state: string): boolean {
	return state.startsWith("authenticated_");
}

export default async function AccountPage({
	searchParams,
}: {
	searchParams: Promise<{ acesso?: string }>;
}) {
	const query = await searchParams;
	const access = await currentAccess();
	const authenticated = isAuthenticatedState(access.state);
	const descriptions = {
		anonymous: "Entre com sua conta do Discord para consultar seu acesso.",
		unavailable:
			"Não foi possível verificar seu acesso agora. Tente novamente em instantes.",
		authenticated_unlinked:
			"Você entrou com o Discord. Sua conta ainda precisa ser vinculada a um perfil da campanha. Fale com a pessoa responsável pela campanha.",
		authenticated_linked_no_grants:
			"Sua conta está vinculada, mas ainda não tem permissão para acessar as ferramentas da campanha. Fale com a pessoa responsável pela campanha.",
		authenticated_linked:
			"Sua conta está vinculada. Use a navegação global para acessar somente as áreas liberadas para você.",
	} as const;
	const accessNotice =
		query.acesso === "negado"
			? "Sua conta não tem acesso à área que você tentou abrir. Escolha outra área disponível pela navegação global."
			: query.acesso === "indisponivel"
				? "A área que você tentou abrir não conseguiu verificar seu acesso. Tente novamente em instantes."
				: null;
	const canLogout =
		Boolean(authConfig()) && (authenticated || access.identity !== null);

	return (
		<section className={styles.shell}>
			<div className={styles.eyebrow}>TDA · CONTA E ACESSO</div>
			<h1 className={styles.title}>Conta e acesso</h1>
			{access.identity?.displayName ? (
				<p className={styles.description}>
					Conectado como <strong>{access.identity.displayName}</strong>.
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
					<ActionLink href="/entrar?next=%2Fconta" variant="primary">
						Entrar com Discord
					</ActionLink>
				) : null}
				{access.state === "unavailable" ? (
					<Link href="/conta">Tentar verificar novamente</Link>
				) : null}
				<Link href="/sessoes">Ver histórias públicas</Link>
			</div>

			<div className={styles.accountSession}>
				{canLogout ? (
					<form action="/auth/logout" method="post">
						<Button type="submit">Sair da conta</Button>
					</form>
				) : null}
			</div>
		</section>
	);
}
