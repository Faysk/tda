import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { OperationalPageHeader } from "@/components/operational-page-header";
import { currentAccess } from "@/features/auth/server";
import { readNavigationCampaigns } from "@/features/campaigns/navigation";
import { canManageCampaignRegistry } from "@/features/campaigns/policy";
import { firstAuthorizedEditDestination } from "@/features/edit/navigation-entry";
import styles from "./campanhas/page.module.css";

export const metadata: Metadata = {
	title: "Edit",
	description:
		"Entrypoint de compatibilidade para as ferramentas administrativas do TDA.",
};

export default async function EditPage() {
	const access = await currentAccess();

	if (access.state === "anonymous") redirect("/entrar?next=%2Fedit");
	if (access.state === "unavailable")
		redirect("/conta?acesso=indisponivel");
	if (
		(access.state !== "authenticated_linked" &&
			access.state !== "authenticated_linked_no_grants") ||
		!access.context
	)
		redirect("/conta?acesso=negado");

	if (canManageCampaignRegistry(access.context)) redirect("/edit/campanhas");

	const navigation = await readNavigationCampaigns(access.context);
	if (navigation.mode === "unavailable")
		redirect("/conta?acesso=indisponivel");
	if (navigation.campaigns.length === 0)
		redirect("/conta?acesso=negado");

	if (navigation.campaigns.length === 1) {
		const campaign = navigation.campaigns[0];
		const destination = firstAuthorizedEditDestination(
			access.context,
			campaign.technicalSlug,
		);
		if (destination) redirect(destination);
	}

	const choices = navigation.campaigns.map((campaign) => ({
		campaign,
		href: firstAuthorizedEditDestination(
			access.context,
			campaign.technicalSlug,
		),
	}));

	return (
		<main
			className={styles.page}
			data-layout-family="workspace"
			data-layout-role="editorial"
		>
			<OperationalPageHeader
				eyebrow="Edit"
				title="Escolha a campanha"
				description={<p>Abra as ferramentas no contexto da campanha certa.</p>}
			/>

			<section className={styles.registry} aria-labelledby="edit-campaign-choice">
				<div className={styles.registryHeading}>
					<h2 id="edit-campaign-choice">Campanhas disponíveis</h2>
					<span>{choices.length}</span>
				</div>
				<div className={styles.list}>
					{choices.map(({ campaign, href }) => (
						<article className={styles.item} key={campaign.technicalSlug}>
							<header className={styles.itemHeader}>
								<div>
									<p className={styles.technical}>Campanha</p>
									<h3>{campaign.name}</h3>
								</div>
								<span
									className={styles.badge}
									data-state={campaign.lifecycle}
								>
									{campaign.lifecycle === "active" ? "Ativa" : "Arquivada"}
								</span>
							</header>
							{href ? (
								<Link className={styles.publicLink} href={href}>
									Abrir ferramentas
								</Link>
							) : (
								<p className={styles.state} role="status">
									As ferramentas desta campanha ainda não possuem uma rota
									campaign-aware segura neste slice.
								</p>
							)}
						</article>
					))}
				</div>
			</section>
		</main>
	);
}
