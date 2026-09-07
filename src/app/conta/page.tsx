import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui";
import { currentAccess } from "@/features/auth/server";
import { authConfig } from "@/features/auth/config";
import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
} from "@/features/edit/access/policy";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import styles from "@/features/auth/access.module.css";

export const metadata: Metadata = {
	title: "Minha conta",
	robots: { index: false, follow: false },
};
export default async function AccountPage() {
	const access = await currentAccess();
	const allowed =
		access.context &&
		authorizeCampaignCapability(
			access.context,
			EDIT_CAPABILITIES.transcriptRead,
			CAMPAIGN_SLUG,
		).ok;
	const localAllowed =
		access.context &&
		authorizeCampaignCapability(
			access.context,
			EDIT_CAPABILITIES.localProcess,
			CAMPAIGN_SLUG,
		).ok;
	const descriptions = {
		anonymous: "Entre com sua conta do Discord para consultar seu acesso.",
		unavailable:
			"Não foi possível verificar seu acesso agora. Tente novamente em instantes.",
		authenticated_unlinked:
			"Você entrou com o Discord. Sua conta ainda precisa ser vinculada a um perfil da campanha. Fale com a pessoa responsável pela campanha.",
		authenticated_linked_no_grants:
			"Sua conta está vinculada, mas ainda não tem permissão para acessar a administração. Fale com a pessoa responsável pela campanha.",
		authenticated_linked: allowed
			? "Seu acesso às transcrições da campanha está liberado."
			: "Sua conta está vinculada, mas não tem permissão de leitura das transcrições.",
	};
	return (
		<section className={styles.shell}>
			<div className={styles.eyebrow}>TDA · SUA CONTA</div>
			<h1 className={styles.title}>
				{allowed ? "Seu espaço na campanha" : "Acesso à campanha"}
			</h1>
			<p className={styles.description} role="status">
				{descriptions[access.state]}
			</p>
			<div className={styles.actions}>
				{allowed ? <Link href="/transcricoes">Palavras e tempo das transcrições</Link> : null}
				{allowed ? <Link href="/edit">Abrir Edit</Link> : null}
				<Link href={`/edit/${CAMPAIGN_SLUG}/permissions`}>Consultar permissões</Link>
				{localAllowed ? (
					<Link href="/edit/processamento">Processamento local</Link>
				) : null}
				{access.state === "anonymous" || access.state === "unavailable" ? (
					<Link href="/entrar">Entrar com Discord</Link>
				) : null}
				<Link href="/sessoes">Ver histórias públicas</Link>
				{authConfig() && access.state !== "anonymous" ? (
					<form action="/auth/logout" method="post">
						<Button type="submit">Sair da conta</Button>
					</form>
				) : null}
			</div>
		</section>
	);
}
