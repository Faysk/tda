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
	const descriptions = {
		anonymous:
			"Entre com sua conta do Discord para consultar seu vínculo e estado de acesso.",
		unavailable:
			"Não foi possível verificar sua conta e seu acesso agora. Tente novamente em instantes.",
		authenticated_unlinked:
			"Você entrou com o Discord, mas sua conta ainda precisa ser vinculada a um perfil da campanha. Fale com a pessoa responsável pela campanha.",
		authenticated_linked_no_grants:
			"Sua conta está vinculada, mas nenhuma ferramenta administrativa está liberada para ela neste momento.",
		authenticated_linked:
			"Sua conta está vinculada. Abra as ferramentas disponíveis pelo botão de navegação no cabeçalho.",
	} as const;
	const accessNotice =
		query.acesso === "negado"
			? "Sua conta não tem acesso à área que você tentou abrir. Consulte seu estado abaixo ou use a navegação para abrir outra área disponível."
			: query.acesso === "indisponivel"
				? "A área que você tentou abrir não conseguiu verificar seu acesso. Tente novamente em instantes."
				: null;
	const accountName = access.identity?.displayName ?? null;

	return (
		<section className={styles.shell}>
			<div className={styles.eyebrow}>TDA · SUA CONTA</div>
			<h1 className={styles.title}>Conta e acesso</h1>
			<p className={styles.description} role="status">
				{descriptions[access.state]}
			</p>
			{accountName ? (
				<p className={styles.description}>
					Conta Discord: <strong>{accountName}</strong>
				</p>
			) : null}
			{accessNotice ? (
				<p className={styles.notice} role="alert">
					{accessNotice}
				</p>
			) : null}
			<div className={styles.actions}>
				{access.state === "anonymous" || access.state === "unavailable" ? (
					<ActionLink href="/entrar" variant="primary">
						Entrar com Discord
					</ActionLink>
				) : null}
				<Link href="/sessoes">Ver histórias públicas</Link>
			</div>
			<div className={styles.accountSession}>
				{authConfig() && access.state !== "anonymous" ? (
					<form action="/auth/logout" method="post">
						<Button type="submit">Sair da conta</Button>
					</form>
				) : null}
			</div>
		</section>
	);
}
