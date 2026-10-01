import type { Metadata } from "next";
import Image from "next/image";
import { PublicLink as Link } from "@/components/public-link";
import { buildPublicMetadata } from "@/config/public-metadata";
import {
	listedLoreCatalogueEntries,
	type LoreCatalogueEntry,
} from "@/features/lore/standalone-catalog";
import { resolveStandaloneLoreCampaignLink } from "@/features/lore/standalone-link-repository";
import styles from "./page.module.css";

export const metadata: Metadata = buildPublicMetadata({
	title: "Lores",
	description:
		"Histórias especiais do TDA apresentadas como experiências editoriais e cinematográficas.",
	pathname: "/lore",
});

const loreCardSizes =
	"(max-width: 650px) calc(100vw - 40px), (max-width: 2160px) 93vw, 2016px";

type CatalogueCard = Readonly<{
	lore: LoreCatalogueEntry;
	campaign: Readonly<{ routeKey: string; name: string }> | null;
}>;

function LoreCard({ card }: { card: CatalogueCard }) {
	const { lore, campaign } = card;
	return (
		<article
			className={styles.card}
			data-lore={lore.slug}
			data-lore-campaign={campaign?.routeKey ?? "standalone"}
		>
			<Image
				className={styles.cardBackground}
				src={lore.cover}
				alt=""
				fill
				unoptimized
				sizes={loreCardSizes}
			/>
			<div className={styles.cardShade} aria-hidden="true" />
			<Link className={styles.cardLink} href={`/lore/${lore.slug}`}>
				<div className={styles.cardCopy}>
					<span>
						{campaign ? `${campaign.name} · ${lore.name}` : lore.name}
					</span>
					<h2>{lore.title}</h2>
					<p>{lore.description}</p>
					<span className={styles.action}>
						Começar a história <span aria-hidden="true">→</span>
					</span>
				</div>
			</Link>
		</article>
	);
}

export default async function LoreIndexRoute() {
	const lores = listedLoreCatalogueEntries();
	const resolved = await Promise.all(
		lores.map(async (lore) => ({
			lore,
			campaign:
				(await resolveStandaloneLoreCampaignLink(lore.slug))?.publicCampaign ??
				null,
		})),
	);
	const cards = resolved satisfies readonly CatalogueCard[];
	const publicCampaigns = Array.from(
		new Map(
			cards.flatMap((card) =>
				card.campaign
					? [[card.campaign.routeKey, card.campaign] as const]
					: [],
			),
		).values(),
	);
	const grouped = publicCampaigns.length > 1;

	return (
		<div
			className={styles.page}
			data-layout-family="editorial"
			data-layout-role="expansive"
		>
			<header className={styles.hero}>
				<p className={styles.eyebrow}>Arquivo cinematográfico</p>
				<h1>Histórias que ganharam outro palco.</h1>
				<p>
					Lores especiais do TDA, reunidas em experiências próprias. Quando
					uma história pertence a uma campanha pública, esse contexto aparece
					antes mesmo de abrir a página.
				</p>
			</header>

			{grouped ? (
				<section
					className={styles.groups}
					aria-label="Lores publicadas por campanha"
					data-lore-catalogue-mode="grouped"
				>
					{publicCampaigns.map((campaign) => (
						<section
							className={styles.campaignGroup}
							id={`campanha-${campaign.routeKey}`}
							key={campaign.routeKey}
							aria-labelledby={`campanha-${campaign.routeKey}-title`}
						>
							<header className={styles.groupHeader}>
								<p>Campanha</p>
								<h2 id={`campanha-${campaign.routeKey}-title`}>
									{campaign.name}
								</h2>
							</header>
							<div className={styles.archive}>
								{cards
									.filter(
										(card) =>
											card.campaign?.routeKey === campaign.routeKey,
									)
									.map((card) => (
										<LoreCard card={card} key={card.lore.slug} />
									))}
							</div>
						</section>
					))}
					{cards.some((card) => !card.campaign) ? (
						<section
							className={styles.campaignGroup}
							aria-labelledby="lores-independentes-title"
						>
							<header className={styles.groupHeader}>
								<p>Arquivo independente</p>
								<h2 id="lores-independentes-title">Outras histórias</h2>
							</header>
							<div className={styles.archive}>
								{cards
									.filter((card) => !card.campaign)
									.map((card) => (
										<LoreCard card={card} key={card.lore.slug} />
									))}
							</div>
						</section>
					) : null}
				</section>
			) : (
				<section
					className={styles.archive}
					aria-label="Lores publicadas"
					data-lore-catalogue-mode="flat"
				>
					{cards.map((card) => (
						<LoreCard card={card} key={card.lore.slug} />
					))}
				</section>
			)}
		</div>
	);
}
