import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { readPublicCampaignDirectory } from "@/features/campaigns/server";
import { worldPublicCampaignHref } from "@/features/world-explorer/world-campaign";
import { requestedWorldFocus } from "@/features/world-explorer/world-page";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	title: "Mundo · Ecos da Jornada",
	description: "Escolha uma campanha para explorar pessoas, lugares e histórias conectadas.",
};

type Props = {
	searchParams: Promise<{ foco?: string | string[] }>;
};

export default async function MundoEntryPage({ searchParams }: Props) {
	const [directory, query] = await Promise.all([
		readPublicCampaignDirectory(),
		searchParams,
	]);
	const focus = requestedWorldFocus(query);
	if (!directory.ok) {
		return (
			<section className={styles.page} role="status">
				<p className={styles.eyebrow}>Mundo</p>
				<h1>Campanhas indisponíveis</h1>
				<p className={styles.lead}>
					O diretório público não pôde ser consultado agora. Nenhuma campanha foi
					escolhida por fallback.
				</p>
			</section>
		);
	}
	const onlyCampaign =
		directory.campaigns.length === 1 ? directory.campaigns[0] : undefined;
	if (onlyCampaign) {
		redirect(worldPublicCampaignHref(onlyCampaign.routeKey, focus));
	}

	return (
		<section className={styles.page}>
			<p className={styles.eyebrow}>Ecos da Jornada</p>
			<h1>Escolha a campanha</h1>
			<p className={styles.lead}>
				Cada Mundo possui relações, layout e publicação próprios. Abrir uma campanha
				não reutiliza estado editorial de outra.
			</p>
			{directory.campaigns.length ? (
				<ul className={styles.list}>
					{directory.campaigns.map((campaign) => (
						<li key={campaign.routeKey}>
							<Link
								className={styles.link}
								href={worldPublicCampaignHref(campaign.routeKey, focus)}
							>
								<strong>{campaign.name}</strong>
								<span>{campaign.description ?? "Explorar o Mundo desta campanha."}</span>
							</Link>
						</li>
					))}
				</ul>
			) : (
				<p className={styles.lead}>Nenhuma campanha pública está disponível.</p>
			)}
		</section>
	);
}
