import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { buildPublicMetadata } from "@/config/public-metadata";
import { buildCampaignDirectoryCards } from "@/features/campaigns/directory-presentation";
import { readPublicCampaignDirectory } from "@/features/campaigns/server";
import {
	formatArchiveDate,
	formatArchiveNumber,
} from "@/features/sessions/archive";
import { listPublishedSessionArchive } from "@/features/sessions/repository";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = buildPublicMetadata({
	title: "Campanhas",
	description:
		"Campanhas públicas do TDA — histórias, sessões e mundos organizados por mesa.",
	pathname: "/campanhas",
});

async function readDirectorySessions() {
	try {
		return await listPublishedSessionArchive();
	} catch {
		return null;
	}
}

function memoryCountLabel(count: number | null) {
	if (count === null) return null;
	if (count === 0) return "Nenhuma memória publicada";
	if (count === 1) return "1 memória publicada";
	return `${formatArchiveNumber(count)} memórias publicadas`;
}

export default async function CampaignDirectoryPage() {
	const [result, sessions] = await Promise.all([
		readPublicCampaignDirectory(),
		readDirectorySessions(),
	]);
	const cards = result.ok
		? buildCampaignDirectoryCards(result.campaigns, sessions)
		: [];

	return (
		<main
			className={styles.page}
			data-layout-family="editorial"
			data-campaign-registry={result.ok ? result.registryMode : "unavailable"}
		>
			<header className={styles.header}>
				<p className={styles.eyebrow}>TDA · campanhas</p>
				<h1>Campanhas</h1>
				<p>
					Cada mesa guarda seu próprio mundo. Escolha uma campanha para abrir
					suas memórias publicadas.
				</p>
			</header>

			{!result.ok ? (
				<section className={styles.state} role="status">
					<h2>Diretório temporariamente indisponível</h2>
					<p>
						Não conseguimos carregar as campanhas agora. Tente novamente em
						instantes.
					</p>
				</section>
			) : cards.length === 0 ? (
				<section className={styles.state}>
					<h2>Nenhuma campanha pública ainda</h2>
					<p>Quando uma mesa estiver pronta para o público, ela aparece aqui.</p>
				</section>
			) : (
				<section className={styles.grid} aria-label="Campanhas públicas">
					{cards.map((campaign) => {
						const countLabel = memoryCountLabel(
							campaign.publishedSessionCount,
						);
						const description =
							campaign.description ||
							(campaign.publishedSessionCount === 0
								? "A primeira memória pública desta campanha ainda está por vir."
								: "Sessões e memórias publicadas desta campanha.");

						return (
							<article
								className={styles.card}
								key={campaign.routeKey}
								data-campaign-card
								data-campaign-route={campaign.routeKey}
							>
								<div
									className={styles.cover}
									data-campaign-artwork-source={campaign.artworkSource}
									aria-hidden="true"
								>
									{campaign.artwork ? (
										<Image
											className={styles.coverImage}
											src={campaign.artwork}
											alt=""
											fill
											sizes="(max-width: 700px) calc(100vw - 40px), 620px"
										/>
									) : (
										<div className={styles.coverFallback}>
											<span>TDA</span>
											<small>Arquivo da campanha</small>
										</div>
									)}
									<div className={styles.coverShade} />
									<span className={styles.coverLabel}>Campanha</span>
								</div>

								<div className={styles.cardBody}>
									<div className={styles.cardCopy}>
										<h2>{campaign.name}</h2>
										<p>{description}</p>
									</div>

									{campaign.latestSession ? (
										<div className={styles.latest}>
											<span>Última memória</span>
											<strong>{campaign.latestSession.title}</strong>
											{campaign.latestSession.date ? (
												<time dateTime={campaign.latestSession.date}>
													{formatArchiveDate(campaign.latestSession.date)}
												</time>
											) : null}
										</div>
									) : null}

									<div className={styles.cardFooter}>
										{countLabel ? (
											<span className={styles.count}>{countLabel}</span>
										) : (
											<span className={styles.count} aria-hidden="true" />
										)}
										<Link
											className={styles.link}
											href={`/campanhas/${campaign.routeKey}/sessoes`}
										>
											Abrir campanha <span aria-hidden="true">→</span>
										</Link>
									</div>
								</div>
							</article>
						);
					})}
				</section>
			)}
		</main>
	);
}
