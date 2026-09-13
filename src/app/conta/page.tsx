import type { Metadata } from "next";
import { PublicLink as Link } from "@/components/public-link";
import { ActionLink, Button } from "@/components/ui";
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
export default async function AccountPage({
	searchParams,
}: {
	searchParams: Promise<{ acesso?: string }>;
}) {
	const query = await searchParams;
	const access = await currentAccess();
	const allowed =
		access.context &&
		authorizeCampaignCapability(
			access.context,
			EDIT_CAPABILITIES.transcriptRead,
			CAMPAIGN_SLUG,
		).ok;
	const permissionsAllowed =
		access.context &&
		authorizeCampaignCapability(
			access.context,
			EDIT_CAPABILITIES.permissionsManage,
			CAMPAIGN_SLUG,
		).ok;
	const localAllowed =
		access.context &&
		authorizeCampaignCapability(
			access.context,
			EDIT_CAPABILITIES.localProcess,
			CAMPAIGN_SLUG,
		).ok;
	const worldAllowed =
		access.context &&
		authorizeCampaignCapability(
			access.context,
			EDIT_CAPABILITIES.worldLayoutEdit,
			CAMPAIGN_SLUG,
		).ok;
	const hubAllowed = allowed || permissionsAllowed || localAllowed || worldAllowed;
	const hasTasks = hubAllowed;
	const descriptions = {
		anonymous: "Entre com sua conta do Discord para consultar seu acesso.",
		unavailable:
			"Não foi possível verificar seu acesso agora. Tente novamente em instantes.",
		authenticated_unlinked:
			"Você entrou com o Discord. Sua conta ainda precisa ser vinculada a um perfil da campanha. Fale com a pessoa responsável pela campanha.",
		authenticated_linked_no_grants:
			"Sua conta está vinculada, mas ainda não tem permissão para acessar a administração. Fale com a pessoa responsável pela campanha.",
		authenticated_linked: hasTasks
			? "Escolha uma das tarefas disponíveis para sua conta nesta campanha."
			: "Sua conta está vinculada. Nenhuma tarefa administrativa está disponível para você neste momento.",
	};
	const accessNotice =
		query.acesso === "negado"
			? "Sua conta não tem acesso à área que você tentou abrir. Use uma das tarefas disponíveis abaixo."
			: query.acesso === "indisponivel"
				? "A área que você tentou abrir não conseguiu verificar seu acesso. Tente novamente em instantes."
				: null;
	return (
		<section className={`${styles.shell} ${styles.accountShell}`}>
			<div className={styles.eyebrow}>TDA · SUA CONTA</div>
			<h1 className={styles.title}>
				{hasTasks ? "Seu espaço na campanha" : "Acesso à campanha"}
			</h1>
			<p className={styles.description} role="status">
				{descriptions[access.state]}
			</p>
			{accessNotice ? (
				<p className={styles.notice} role="alert">
					{accessNotice}
				</p>
			) : null}
			<nav aria-label="Espaços da campanha" className={styles.taskGrid}>
				{[
					{
						visible: allowed,
						id: "transcripts",
						href: "/transcricoes",
						title: "Palavras e tempo das transcrições",
						description:
							"Consulte as sessões, a contagem de palavras e a duração registrada.",
					},
					{
						visible: hubAllowed,
						id: "edit",
						href: "/edit",
						title: "Abrir Edit",
						description:
							"Acesse as ferramentas administrativas disponíveis para a sua conta.",
					},
					{
						visible: permissionsAllowed,
						id: "permissions",
						href: `/edit/${CAMPAIGN_SLUG}/permissions`,
						title: "Consultar permissões",
						description:
							"Veja quem tem acesso e quais ações estão liberadas na campanha.",
					},
					{
						visible: localAllowed,
						id: "processing",
						href: "/edit/processamento",
						title: "Processamento local",
						description:
							"Conecte o aplicativo deste computador e acompanhe a fila local.",
					},
				]
					.filter((task) => task.visible)
					.map((task) => (
						<Link
							key={task.id}
							href={task.href}
							className={styles.taskCard}
							aria-labelledby={`task-${task.id}`}
							aria-describedby={`task-description-${task.id}`}
						>
							<span id={`task-${task.id}`} className={styles.taskTitle}>
								{task.title}
								<span aria-hidden="true"> →</span>
							</span>
							<span
								id={`task-description-${task.id}`}
								className={styles.taskDescription}
							>
								{task.description}
							</span>
						</Link>
					))}
			</nav>
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
