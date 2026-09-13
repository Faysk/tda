import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PublicLink as Link } from "@/components/public-link";
import { currentAccess } from "@/features/auth/server";
import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
	type EditCapability,
} from "@/features/edit/access/policy";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import styles from "./page.module.css";

export const metadata: Metadata = {
	title: "Edit",
	description: "Ferramentas administrativas do TDA.",
};

type EditModule = Readonly<{
	title: string;
	description: string;
	href: string;
	capability: EditCapability;
}>;

const MODULES: readonly EditModule[] = [
	{
		title: "Sessões",
		description: "Consulte sessões e revise as transcrições da campanha.",
		href: "/edit/sessoes",
		capability: EDIT_CAPABILITIES.transcriptRead,
	},
	{
		title: "Processamento local",
		description: "Envie arquivos, acompanhe a fila e conecte o TDA Companion.",
		href: "/edit/processamento",
		capability: EDIT_CAPABILITIES.localProcess,
	},
	{
		title: "Mundo",
		description: "Ajuste a composição editorial do explorador do mundo.",
		href: "/edit/mundo",
		capability: EDIT_CAPABILITIES.worldLayoutEdit,
	},
] as const;

export default async function EditPage() {
	const access = await currentAccess();

	if (access.state === "anonymous") redirect("/entrar?next=%2Fedit");
	if (access.state === "unavailable") redirect("/conta?acesso=indisponivel");
	if (access.state !== "authenticated_linked" || !access.context)
		redirect("/conta?acesso=negado");

	const modules = MODULES.filter((module) =>
		authorizeCampaignCapability(
			access.context,
			module.capability,
			CAMPAIGN_SLUG,
		).ok,
	);

	return (
		<section className={styles.shell}>
			<header className={styles.header}>
				<p className={styles.eyebrow}>TDA / EDIT</p>
				<h1 className={styles.title}>Ferramentas administrativas</h1>
				<p className={styles.lead}>
					Acesse somente as áreas liberadas para a sua conta. Cada ferramenta
					mantém suas próprias regras de leitura, processamento e escrita.
				</p>
			</header>

			{modules.length ? (
				<nav className={styles.moduleList} aria-label="Ferramentas administrativas">
					{modules.map((module) => (
						<Link className={styles.moduleLink} href={module.href} key={module.href}>
							<h2 className={styles.moduleTitle}>{module.title}</h2>
							<p className={styles.moduleDescription}>{module.description}</p>
							<span className={styles.moduleAction} aria-hidden="true">
								Abrir →
							</span>
						</Link>
					))}
				</nav>
			) : (
				<p className={styles.empty}>
					Sua conta tem acesso administrativo, mas não há uma ferramenta disponível
					para as permissões atuais.
				</p>
			)}
		</section>
	);
}
