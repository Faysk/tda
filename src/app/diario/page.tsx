import { PublicLink as Link } from "@/components/public-link";
import { buildPublicMetadata } from "@/config/public-metadata";
import diaries from "@/features/diary/catalog.json";
import { resolveStandaloneLoreCampaignLink } from "@/features/lore/standalone-link-repository";
import styles from "./page.module.css";

export const metadata = buildPublicMetadata({
	title: "Diários",
	description: "Memórias escritas pelos personagens, um diário de cada vez.",
	pathname: "/diario",
});

type DiaryEntry = (typeof diaries)[number];

type DiaryCard = Readonly<{
	diary: DiaryEntry;
	campaign: Readonly<{ routeKey: string; name: string }> | null;
}>;

async function resolveDiaryCard(diary: DiaryEntry): Promise<DiaryCard> {
	const linked = await resolveStandaloneLoreCampaignLink(diary.loreSlug).catch(
		() => null,
	);
	return {
		diary,
		campaign:
			linked?.technicalSlug === diary.campaignTechnicalSlug
				? linked.publicCampaign
				: null,
	};
}

export default async function DiaryIndex() {
	const cards = await Promise.all(diaries.map(resolveDiaryCard));

	return (
		<section
			className={styles.archive}
			data-layout-family="editorial"
			data-layout-role="expansive"
			data-layout-content-role="editorial"
		>
			<header className={styles.heading}>
				<p className={styles.eyebrow}>Entre páginas</p>
				<h1>Diários</h1>
				<p>
					Memórias escritas pelos personagens, com suas próprias vozes e
					contexto editorial quando ele pode ser mostrado publicamente.
				</p>
			</header>
			{cards.length ? (
				<ul className={styles.books}>
					{cards.map(({ diary, campaign }) => (
						<li key={diary.slug}>
							<article
								className={styles.book}
								data-diary={diary.slug}
								data-diary-campaign={campaign?.routeKey ?? "standalone"}
							>
								<div className={styles.spine} aria-hidden="true">
									{diary.author}
								</div>
								<div className={styles.bookCopy}>
									<p className={styles.eyebrow}>{diary.author}</p>
									<h2>{diary.title}</h2>
									<p>{diary.description}</p>
									<nav
										className={styles.context}
										aria-label={`Contexto editorial de ${diary.title}`}
									>
										{campaign ? (
											<Link
												href={`/campanhas/${campaign.routeKey}`}
												className={styles.contextLink}
											>
												Campanha · {campaign.name}
											</Link>
										) : null}
										<Link
											href={`/lore/${diary.loreSlug}`}
											className={styles.contextLink}
										>
											Conhecer a lore
										</Link>
									</nav>
								</div>
								{/* Standalone documents require a full navigation outside the React shell. */}
								<a className={styles.action} href={`/diario/${diary.slug}`}>
									Abrir o diário <span aria-hidden="true">→</span>
								</a>
							</article>
						</li>
					))}
				</ul>
			) : (
				<p className={styles.empty}>Nenhum diário está publicado neste arquivo.</p>
			)}
		</section>
	);
}
