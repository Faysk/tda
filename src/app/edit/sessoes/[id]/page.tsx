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
	title: "Sessão · Edit",
	description: "Escolha a campanha antes de abrir a sessão privada.",
	robots: { index: false, follow: false },
};

export default async function EditSessionLegacyEntry({
	params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
	const [{ id }, access] = await Promise.all([params, currentAccess()]);
	const sourceSessionId = String(id || "").trim();
	if (access.state === "anonymous")
		redirect(
			"/entrar?next=" +
				encodeURIComponent(
					"/edit/sessoes/" + encodeURIComponent(sourceSessionId),
				),
		);
	if (access.state === "unavailable")
		redirect("/conta?acesso=indisponivel");
	if (!access.context?.profileId)
		redirect("/conta?acesso=negado");

	const available = await readAuthorizedCampaignsForCapability(
		access.context,
		EDIT_CAPABILITIES.transcriptRead,
	);
	if (!available.ok)
		redirect("/conta?acesso=indisponivel");

	if (available.campaigns.length === 1) {
		const campaign = available.campaigns[0]!;
		redirect(
			"/edit/" +
				encodeURIComponent(campaign.technicalSlug) +
				"/sessoes/" +
				encodeURIComponent(sourceSessionId),
		);
	}

	return (
		<section className={styles.shell}>
			<header className={styles.pageHeader}>
				<div>
					<p className={styles.libraryEyebrow}>TDA / EDIT / SESSÃO</p>
					<h1 className={styles.pageTitle}>Escolha a campanha</h1>
					<p className={styles.muted}>
						O identificador da sessão pode existir em mais de uma campanha.
						Nenhum contexto padrão será assumido.
					</p>
				</div>
			</header>
			<div className={styles.libraryList}>
				{available.campaigns.map((campaign) => (
					<article className={styles.libraryRow} key={campaign.technicalSlug}>
						<div className={styles.libraryPrimary}>
							<h2 className={styles.sessionTitle}>{campaign.name}</h2>
							<div className={styles.librarySecondary}>
								<span>Abrir a sessão somente neste escopo</span>
							</div>
						</div>
						<Link
							className={styles.libraryOpen}
							href={
								"/edit/" +
								encodeURIComponent(campaign.technicalSlug) +
								"/sessoes/" +
								encodeURIComponent(sourceSessionId)
							}
						>
							Abrir sessão
						</Link>
					</article>
				))}
			</div>
		</section>
	);
}
