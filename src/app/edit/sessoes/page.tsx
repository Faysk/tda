import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { OperationalPageHeader } from "@/components/operational-page-header";
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
			<section
				className={styles.locked}
				data-layout-family="workspace"
				data-layout-role="editorial"
				role="status"
			>
				<OperationalPageHeader
					eyebrow="Edit · Sessões"
					title="Campanhas indisponíveis"
					description={<p>Não foi possível consultar as campanhas agora.</p>}
				/>
			</section>
		);
	}
	const onlyCampaign =
		eligible.campaigns.length === 1 ? eligible.campaigns[0] : undefined;
	if (onlyCampaign) redirect(editSessionLibraryHref(onlyCampaign.routeKey));

	return (
		<section
			className={[styles.shell, styles.libraryShell].join(" ")}
			data-layout-family="workspace"
			data-layout-role="editorial"
		>
			<OperationalPageHeader
				eyebrow="Edit · Sessões"
				title="Escolha a campanha"
				description={<p>Abra a biblioteca editorial da campanha certa.</p>}
			/>
			{eligible.campaigns.length ? (
				<div className={styles.libraryList}>
					{eligible.campaigns.map((campaign) => (
						<article
							className={[styles.libraryRow, styles.campaignChoiceRow].join(
								" ",
							)}
							key={campaign.id}
						>
							<div className={styles.libraryPrimary}>
								<h2 className={styles.sessionTitle}>{campaign.name}</h2>
								<div className={styles.librarySecondary}>
									<span>
										{campaign.lifecycle === "active"
											? "Campanha ativa"
											: "Campanha arquivada"}
									</span>
								</div>
							</div>
							<Link
								className={styles.libraryOpen}
								href={editSessionLibraryHref(campaign.routeKey)}
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
