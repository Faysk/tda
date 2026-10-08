import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { OperationalPageHeader } from "@/components/operational-page-header";
import { currentAccess } from "@/features/auth/server";
import { readEditableWorldCampaigns } from "@/features/campaigns/world";
import styles from "@/features/edit/workbench.module.css";
import { worldEditCampaignHref } from "@/features/world-explorer/world-campaign";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	title: "Mundo · Edit",
	description: "Escolha a campanha para abrir o authoring do World Explorer.",
};

export default async function EditWorldCompatibilityPage() {
	const access = await currentAccess();
	if (access.state === "anonymous") redirect("/entrar?next=%2Fedit%2Fmundo");
	if (access.state === "unavailable") redirect("/conta?acesso=indisponivel");
	if (!access.context?.profileId) redirect("/conta?acesso=negado");

	const eligible = await readEditableWorldCampaigns(access.context);
	if (!eligible.ok) {
		return (
			<main
				className={[styles.shell, styles.libraryShell].join(" ")}
				data-layout-family="workspace"
				data-layout-role="editorial"
			>
				<OperationalPageHeader
					eyebrow="Edit · Mundo"
					title="Campanhas indisponíveis"
					description={<p>Não foi possível consultar as campanhas agora.</p>}
				/>
			</main>
		);
	}
	const onlyCampaign = eligible.campaigns.length === 1 ? eligible.campaigns[0] : undefined;
	if (onlyCampaign) {
		redirect(worldEditCampaignHref(onlyCampaign.routeKey));
	}

	return (
		<main
			className={[styles.shell, styles.libraryShell].join(" ")}
			data-layout-family="workspace"
			data-layout-role="editorial"
		>
			<OperationalPageHeader
				eyebrow="Edit · Mundo"
				title="Escolha a campanha"
				description={<p>Abra o editor do Mundo no contexto certo.</p>}
			/>
			{eligible.campaigns.length ? (
				<div className={styles.libraryList}>
					{eligible.campaigns.map((campaign) => (
						<article className={[styles.libraryRow, styles.campaignChoiceRow].join(" ")} key={campaign.technicalSlug}>
							<div className={styles.libraryPrimary}>
								<h2 className={styles.sessionTitle}>{campaign.name}</h2>
							</div>
							<Link
								className={styles.libraryOpen}
								href={worldEditCampaignHref(campaign.routeKey)}
							>
								Abrir Mundo
							</Link>
						</article>
					))}
				</div>
			) : (
				<div className={styles.empty}>
					<h2>Nenhuma campanha autorizada</h2>
					<p>Seu perfil não possui acesso de edição do Mundo em campanha ativa.</p>
				</div>
			)}
		</main>
	);
}
