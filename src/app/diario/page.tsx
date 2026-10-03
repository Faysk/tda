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

export default async function DiaryIndex() {
	const entries = await Promise.all(
		diaries.map(async (diary) => {
			const linked = await resolveStandaloneLoreCampaignLink(diary.loreSlug);
			return {
				diary,
				campaign:
					linked?.technicalSlug === diary.campaignTechnicalSlug
						? linked.publicCampaign
						: null,
			};
		}),
	);

	return (
		<section className={styles.archive} data-layout-family="editorial" data-layout-role="expansive" data-layout-content-role="editorial">
			<header className={styles.heading}>
				<p className={styles.eyebrow}>Entre páginas</p>
				<h1>Diários</h1>
				<p>Memórias escritas pelos personagens, com suas próprias vozes.</p>
			</header>
			<ul className={styles.books}>
				{entries.map(({ diary, campaign }) => (
					<li className={styles.bookEntry} key={diary.slug}>
						{/* Standalone documents require a full navigation outside the React shell. */}
						<a className={styles.book} href={`/diario/${diary.slug}`}>
							<div className={styles.spine} aria-hidden="true">
								{diary.author}
							</div>
							<div className={styles.bookCopy}>
								<p className={styles.eyebrow}>
									{campaign ? `${campaign.name} · ${diary.author}` : diary.author}
								</p>
								<h2>{diary.title}</h2>
								<p>{diary.description}</p>
							</div>
							<span className={styles.action}>
								Abrir o diário <span aria-hidden="true">→</span>
							</span>
						</a>
						<nav className={styles.contextLinks} aria-label={`Contexto de ${diary.title}`}>
							<Link href={`/lore/${diary.loreSlug}`}>Lore de {diary.author}</Link>
							{campaign ? (
								<Link href={`/campanhas/${encodeURIComponent(campaign.routeKey)}/mundo`}>
									Explorar {campaign.name}
								</Link>
							) : null}
						</nav>
					</li>
				))}
			</ul>
		</section>
	);
}
