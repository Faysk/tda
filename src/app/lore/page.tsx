import { PIPIPI_STAGE_BACKGROUND } from "@/config/pipipi-assets";
import type { Metadata } from "next";
import Image from "next/image";
import { PublicLink as Link } from "@/components/public-link";
import { buildPublicMetadata } from "@/config/public-metadata";
import { listedStandaloneLores } from "@/features/lore/standalone-catalog";
import { resolveStandaloneLoreCampaignLink } from "@/features/lore/standalone-link-repository";
import styles from "./page.module.css";

export const metadata: Metadata = buildPublicMetadata({
	title: "Lores",
	description:
		"Histórias especiais da campanha apresentadas como experiências editoriais e cinematográficas.",
	pathname: "/lore",
});

const loreCardSizes =
	"(max-width: 650px) calc(100vw - 40px), (max-width: 2160px) 93vw, 2016px";

export default async function LoreIndexRoute() {
	const standaloneLores = listedStandaloneLores();
	const [standaloneCampaigns, pipipiCampaign] = await Promise.all([
		Promise.all(
			standaloneLores.map(async (lore) => [
				lore.slug,
				(await resolveStandaloneLoreCampaignLink(lore.slug))?.publicCampaign ?? null,
			] as const),
		),
		resolveStandaloneLoreCampaignLink("pipipi"),
	]);
	const campaignByLore = new Map(standaloneCampaigns);
	return (
		<div className={styles.page} data-layout-family="editorial" data-layout-role="expansive">
			<header className={styles.hero}>
				<p className={styles.eyebrow}>Arquivo cinematográfico</p>
				<h1>Histórias que ganharam outro palco.</h1>
				<p>
					Lores especiais da campanha, reunidas em experiências próprias para
					quando uma história pede mais do que uma ficha ou um resumo.
				</p>
			</header>

			<section className={styles.archive} aria-label="Lores publicadas">
				{standaloneLores.map((lore) => (
					<article className={styles.card} key={lore.slug} data-lore={lore.slug}>
						<Image
							className={styles.cardBackground}
							src={lore.cover}
							alt=""
							fill
							unoptimized
							sizes={loreCardSizes}
						/>
						<div className={styles.cardShade} aria-hidden="true" />
						<a className={styles.cardLink} href={`/lore/${lore.slug}`}>
							<div className={styles.cardCopy}>
								<span>
									{lore.name}
									{campaignByLore.get(lore.slug)
										? ` · ${campaignByLore.get(lore.slug)?.name}`
										: ""}
								</span>
								<h2>{lore.title}</h2>
								<p>{lore.description}</p>
								<span className={styles.action}>
									Começar a história <span aria-hidden="true">→</span>
								</span>
							</div>
						</a>
					</article>
				))}
				<article className={styles.card}>
					<Image
						className={styles.cardBackground}
						src={PIPIPI_STAGE_BACKGROUND}
						alt=""
						fill
						sizes={loreCardSizes}
						unoptimized
					/>
					<div className={styles.cardShade} aria-hidden="true" />
					<Link className={styles.cardLink} href="/lore/pipipi">
						<div className={styles.cardCopy}>
							<span>
								Pipipi
								{pipipiCampaign?.publicCampaign
									? ` · ${pipipiCampaign.publicCampaign.name}`
									: ""}
							</span>
							<h2>A Casa Onde os Super-Heróis Visitavam</h2>
							<p>
								A história de Pipipi, da Casa onde viveu e das duas metades de
								uma mesma memória.
							</p>
							<span className={styles.action}>
								Começar a história <span aria-hidden="true">→</span>
							</span>
						</div>
					</Link>
				</article>
			</section>
		</div>
	);
}
