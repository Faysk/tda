import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentAccess } from "@/features/auth/server";
import {
	editSessionDetailHref,
	readEditableSessionCampaigns,
} from "@/features/campaigns/sessions";
import styles from "@/features/edit/workbench.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	title: "Sessão · Edit",
	description: "Escolha a campanha antes de abrir a sessão privada.",
	robots: { index: false, follow: false },
};

type Props = Readonly<{ params: Promise<{ id: string }> }>;

export default async function LegacyEditSessionEntry({ params }: Props) {
	const { id } = await params;
	const sourceSessionId = String(id || "").trim();
	if (!sourceSessionId || sourceSessionId.length > 220) notFound();

	const access = await currentAccess();
	const returnTo = `/edit/sessoes/${encodeURIComponent(sourceSessionId)}`;
	if (access.state === "anonymous")
		redirect(`/entrar?next=${encodeURIComponent(returnTo)}`);
	if (access.state === "unavailable") redirect("/conta?acesso=indisponivel");
	if (!access.context?.profileId) redirect("/conta?acesso=negado");

	const eligible = await readEditableSessionCampaigns(access.context);
	if (!eligible.ok) {
		return (
			<section className={styles.locked} role="status">
				<h1>Campanhas indisponíveis</h1>
				<p className={styles.muted}>
					A sessão não foi procurada globalmente porque a identidade de origem
					pode se repetir entre campanhas.
				</p>
			</section>
		);
	}
	const onlyCampaign =
		eligible.campaigns.length === 1 ? eligible.campaigns[0] : undefined;
	if (onlyCampaign)
		redirect(
			editSessionDetailHref(onlyCampaign.technicalSlug, sourceSessionId),
		);

	return (
		<section className={styles.shell}>
			<header className={styles.pageHeader}>
				<div>
					<p className={styles.libraryEyebrow}>TDA / EDIT / SESSÃO</p>
					<h1 className={styles.pageTitle}>Escolha a campanha</h1>
					<p className={styles.muted}>
						O identificador <code>{sourceSessionId}</code> não é usado como
						lookup global. Escolha o contexto autorizado primeiro.
					</p>
				</div>
			</header>
			<div className={styles.libraryList}>
				{eligible.campaigns.map((campaign) => (
					<article className={styles.libraryRow} key={campaign.id}>
						<div className={styles.libraryPrimary}>
							<h2 className={styles.sessionTitle}>{campaign.name}</h2>
						</div>
						<Link
							className={styles.libraryOpen}
							href={editSessionDetailHref(
								campaign.technicalSlug,
								sourceSessionId,
							)}
						>
							Procurar nesta campanha
						</Link>
					</article>
				))}
			</div>
		</section>
	);
}
