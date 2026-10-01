import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PublicLink as Link } from "@/components/public-link";
import { currentAccess } from "@/features/auth/server";
import { readAuthorizedCampaignsForCapability } from "@/features/campaigns/authorized";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import styles from "@/features/edit/workbench.module.css";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
	title: "Sessões · Edit",
	description: "Escolha a campanha da biblioteca editorial privada.",
	robots: { index: false, follow: false },
};

export default async function EditSessionsEntryPage() {
	const access = await currentAccess();
	if (access.state === "anonymous")
		redirect("/entrar?next=%2Fedit%2Fsessoes");
	if (access.state === "unavailable")
		redirect("/conta?acesso=indisponivel");
	if (!access.context?.profileId)
		redirect("/conta?acesso=negado");

	const available = await readAuthorizedCampaignsForCapability(
		access.context,
		EDIT_CAPABILITIES.transcriptRead,
	);
	if (!available.ok)
		return (
			<section className={styles.locked}>
				<p className={styles.muted}>TDA / EDIT / SESSÕES</p>
				<h1>Campanhas indisponíveis</h1>
				<p className={styles.muted}>
					A sessão está válida, mas o diretório autorizado não pôde ser
					consultado. Nenhuma campanha foi assumida.
				</p>
			</section>
		);

	if (available.campaigns.length === 1) {
		const campaign = available.campaigns[0]!;
		redirect(
			"/edit/" +
				encodeURIComponent(campaign.technicalSlug) +
				"/sessoes",
		);
	}

	return (
		<section className={styles.shell}>
			<header className={styles.pageHeader}>
				<div>
					<p className={styles.libraryEyebrow}>TDA / EDIT / SESSÕES</p>
					<h1 className={styles.pageTitle}>Escolha a campanha</h1>
					<p className={styles.muted}>
						A biblioteca é isolada por campanha. Nenhuma campanha padrão é
						escolhida quando há mais de uma opção autorizada.
					</p>
				</div>
			</header>
			{available.campaigns.length ? (
				<div className={styles.libraryList}>
					{available.campaigns.map((campaign) => (
						<article className={styles.libraryRow} key={campaign.technicalSlug}>
							<div className={styles.libraryPrimary}>
								<h2 className={styles.sessionTitle}>{campaign.name}</h2>
								<div className={styles.librarySecondary}>
									<span>Biblioteca editorial privada</span>
								</div>
							</div>
							<Link
								className={styles.libraryOpen}
								href={
									"/edit/" +
									encodeURIComponent(campaign.technicalSlug) +
									"/sessoes"
								}
							>
								Abrir sessões
							</Link>
						</article>
					))}
				</div>
			) : (
				<div className={styles.empty}>
					<h2>Nenhuma campanha disponível</h2>
					<p>
						Seu perfil não possui acesso de leitura de transcrição em uma
						campanha ativa.
					</p>
				</div>
			)}
		</section>
	);
}
