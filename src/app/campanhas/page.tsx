import type { Metadata } from "next";
import Link from "next/link";
import { buildPublicMetadata } from "@/config/public-metadata";
import { readPublicCampaignDirectory } from "@/features/campaigns/server";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = buildPublicMetadata({
	title: "Campanhas",
	description:
		"Campanhas públicas do TDA — histórias, sessões e mundos organizados por mesa.",
	pathname: "/campanhas",
});

export default async function CampaignDirectoryPage() {
	const result = await readPublicCampaignDirectory();

	return (
		<main className={styles.page} data-layout-family="editorial" data-public-content-state={!result.ok ? "unavailable" : result.campaigns.length ? "ready" : "empty"}>
			<header className={styles.header}>
				<p className={styles.eyebrow}>TDA · campanhas</p>
				<h1>Mesas que viraram memória</h1>
				<p>
					Cada campanha tem seu próprio arquivo. Aqui aparecem somente as que
					estão ativas e publicáveis.
				</p>
			</header>

			{!result.ok ? (
				<section className={styles.state} role="status">
					<h2>Diretório temporariamente indisponível</h2>
					<p>Não conseguimos carregar as campanhas agora. Tente novamente em instantes.</p>
				</section>
			) : result.campaigns.length === 0 ? (
				<section className={styles.state}>
					<h2>Nenhuma campanha pública ainda</h2>
					<p>Quando uma mesa estiver pronta para o público, ela aparece aqui.</p>
				</section>
			) : (
				<section className={styles.grid} aria-label="Campanhas públicas">
					{result.campaigns.map((campaign) => (
						<article className={styles.card} key={campaign.routeKey}>
							<div>
								<p className={styles.cardEyebrow}>Campanha</p>
								<h2>{campaign.name}</h2>
								<p>
									{campaign.description ||
										"Esta campanha ainda não possui uma apresentação pública."}
								</p>
							</div>
							<Link
								className={styles.link}
								href={`/campanhas/${campaign.routeKey}/sessoes`}
							>
								Abrir sessões
							</Link>
						</article>
					))}
				</section>
			)}
		</main>
	);
}
