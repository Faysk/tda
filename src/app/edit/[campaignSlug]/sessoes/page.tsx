import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentAccess } from "@/features/auth/server";
import {
	editSessionLibraryHref,
	readEditableSessionCampaigns,
} from "@/features/campaigns/sessions";
import styles from "@/features/edit/workbench.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	title: "Sessões · Edit",
	description: "Escolha a campanha da biblioteca editorial privada.",
	robots: { index: false, follow: false },
};

export default async function EditSessionsEntryPage() {
	const access = await currentAccess();
	if (access.state === "anonymous") redirect("/entrar?next=%2Fedit%2Fsessoes");
	if (access.state === "unavailable") redirect("/conta?acesso=indisponivel");
	if (!access.context?.profileId) redirect("/conta?acesso=negado");

	const eligible = await readEditableSessionCampaigns(access.context);
	if (!eligible.ok) {
		return (
			<section className={styles.locked} role="status">
				<div className={styles.muted}>TDA / EDIT / SESSÕES</div>
				<h1>Campanhas indisponíveis</h1>
				<p className={styles.muted}>
					O diretório autorizado não pôde ser consultado. Nenhuma campanha foi
					escolhida por fallback.
				</p>
			</section>
		);
	}
	const onlyCampaign =
		eligible.campaigns.length === 1 ? eligible.campaigns[0] : undefined;
	if (onlyCampaign) redirect(editSessionLibraryHref(onlyCampaign.technicalSlug));

	return (
		<section className={styles.shell}>
			<header className={styles.pageHeader}>
				<div>
					<p className={styles.libraryEyebrow}>TDA / EDIT / SESSÕES</p>
					<p className={styles.muted}>{campaign.name}{campaign.lifecycle === "archived" ? " · arquivada" : ""}</p>
					<h1 className={[styles.pageTitle, styles.libraryTitle].join(" ")}>
						Escolha a campanha
					</h1>
					<p className={styles.muted}>
						A biblioteca editorial é isolada por campanha. Nenhuma mesa é
						assumida silenciosamente quando existem várias opções.
					</p>
				</div>
			</header>
			{eligible.campaigns.length ? (
				<div className={styles.libraryList}>
					{eligible.campaigns.map((campaign) => (
						<article className={styles.libraryRow} key={campaign.id}>
							<div className={styles.libraryPrimary}>
								<h2 className={styles.sessionTitle}>{campaign.name}</h2>
								<div className={styles.librarySecondary}>
									<span>
										{campaign.lifecycle === "active" ? "Campanha ativa" : "Campanha arquivada"}
									</span>
								</div>
							</div>
							<Link
								className={styles.libraryOpen}
								href={editSessionLibraryHref(campaign.technicalSlug)}
							>
								Abrir biblioteca
							</Link>
						</article>
					))}
				</div>
			) : (
				<div className={styles.empty}>
					<h2>Nenhuma campanha autorizada</h2>
					<p>Seu perfil não possui acesso de transcrição a nenhuma campanha.</p>
				</div>
			)}
		</section>
	);
}
