import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { buildPublicMetadata } from "@/config/public-metadata";
import { buildCampaignDirectoryCards } from "@/features/campaigns/directory-presentation";
import { readPublicCampaignNarrativeLinks } from "@/features/campaigns/overview";
import { resolvePublicCampaignRoute } from "@/features/campaigns/server";
import { formatArchiveDate } from "@/features/sessions/archive";
import { listPublishedSessionArchive } from "@/features/sessions/repository";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

type Props = {
	params: Promise<{ campaignSlug: string }>;
};

async function readCampaignSessions(routeKey: string) {
	try {
		return await listPublishedSessionArchive(routeKey);
	} catch {
		return null;
	}
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
	const { campaignSlug } = await params;
	const resolved = await resolvePublicCampaignRoute(campaignSlug);

	if (!resolved.ok) {
		return {
			...buildPublicMetadata({
				title: "Campanha",
				description: "Campanha pública do TDA.",
				pathname: "/campanhas",
			}),
			robots: { index: false, follow: false },
		};
	}

	return buildPublicMetadata({
		title: resolved.campaign.name,
		description:
			resolved.campaign.description ||
			`Sessões, mundo e memórias públicas de ${resolved.campaign.name}.`,
		pathname: `/campanhas/${resolved.campaign.routeKey}`,
		image: resolved.campaign.coverImage
			? {
					url: resolved.campaign.coverImage,
					alt: `Capa da campanha ${resolved.campaign.name}`,
					verification: "verified-public",
				}
			: undefined,
	});
}

export default async function CampaignOverviewPage({ params }: Props) {
	const { campaignSlug } = await params;
	const resolved = await resolvePublicCampaignRoute(campaignSlug);

	if (!resolved.ok) {
		if (resolved.reason === "not_found") notFound();
		return (
			<main className={styles.page} data-layout-family="editorial">
				<section className={styles.unavailable} role="status">
					<p className={styles.eyebrow}>TDA · campanha</p>
					<h1>Campanha temporariamente indisponível</h1>
					<p>
						Não foi possível carregar esta campanha agora. O diretório público
						continua disponível.
					</p>
					<Link href="/campanhas">Voltar às campanhas</Link>
				</section>
			</main>
		);
	}

	if (!resolved.canonical) {
		permanentRedirect(`/campanhas/${resolved.campaign.routeKey}`);
	}

	const campaign = resolved.campaign;
	const campaignPath = `/campanhas/${campaign.routeKey}`;
	const [sessions, narrativeLinks] = await Promise.all([
		readCampaignSessions(campaign.routeKey),
		readPublicCampaignNarrativeLinks({
			routeKey: campaign.routeKey,
			technicalSlug: campaign.technicalSlug,
		}),
	]);

	const presentation = buildCampaignDirectoryCards(
		[campaign],
		sessions,
	)[0];
	const sessionArtwork = sessions?.find(
		(session) => session.coverImage || session.heroImage,
	);
	const artwork =
		campaign.coverImage ||
		sessionArtwork?.coverImage ||
		sessionArtwork?.heroImage ||
		null;
	const artworkSource = campaign.coverImage
		? "campaign-cover"
		: artwork
			? "session-artwork"
			: "fallback";
	const artworkAlt =
		artworkSource === "campaign-cover"
			? `Capa da campanha ${campaign.name}`
			: `Arte pública de uma memória de ${campaign.name}`;

	return (
		<main
			className={styles.page}
			data-layout-family="editorial"
			data-campaign-root
			data-campaign-route={campaign.routeKey}
			data-campaign-artwork-source={artworkSource}
		>
			<nav className={styles.breadcrumb} aria-label="Contexto da campanha">
				<Link href="/campanhas">Campanhas</Link>
				<span aria-hidden="true">›</span>
				<span aria-current="page">{campaign.name}</span>
			</nav>

			<section className={styles.hero} aria-labelledby="campaign-title">
				<div className={styles.artwork} data-has-artwork={artwork ? "true" : "false"}>
					{artwork ? (
						<Image
							className={styles.artworkImage}
							src={artwork}
							alt={artworkAlt}
							fill
							priority
							sizes="(max-width: 760px) calc(100vw - 40px), 44vw"
						/>
					) : (
						<div className={styles.artworkFallback} aria-hidden="true">
							<span>TDA</span>
							<small>Arquivo da campanha</small>
						</div>
					)}
				</div>

				<div className={styles.heroCopy}>
					<p className={styles.eyebrow}>Campanha</p>
					<h1 id="campaign-title">{campaign.name}</h1>
					<p className={styles.description}>
						{campaign.description ||
							"Esta campanha ainda não possui uma apresentação editorial pública."}
					</p>

					<nav className={styles.primaryActions} aria-label={`Abrir ${campaign.name}`}>
						<Link className={styles.primaryAction} href={`${campaignPath}/sessoes`}>
							Ver sessões
						</Link>
						<Link className={styles.secondaryAction} href={`${campaignPath}/mundo`}>
							Explorar Mundo
						</Link>
					</nav>

					{sessions === null ? (
						<div className={styles.memoryState} role="status">
							<strong>Memórias temporariamente indisponíveis</strong>
							<span>Os outros acessos públicos da campanha continuam disponíveis.</span>
						</div>
					) : presentation.latestSession ? (
						<aside
							className={styles.latestMemory}
							data-campaign-latest-session={presentation.latestSession.id}
						>
							<p>Última memória publicada</p>
							<Link
								href={`${campaignPath}/sessoes/${encodeURIComponent(
									presentation.latestSession.id,
								)}`}
							>
								{presentation.latestSession.title}
							</Link>
							{presentation.latestSession.date ? (
								<time dateTime={presentation.latestSession.date}>
									{formatArchiveDate(presentation.latestSession.date)}
								</time>
							) : null}
						</aside>
					) : (
						<div className={styles.memoryState} data-campaign-empty="true">
							<strong>Nenhuma memória publicada ainda</strong>
							<span>
								A campanha já pode ser explorada sem preencher o arquivo com
								conteúdo inventado.
							</span>
						</div>
					)}
				</div>
			</section>

			<section className={styles.explore} aria-labelledby="explore-title">
				<div className={styles.sectionHeading}>
					<p className={styles.eyebrow}>Continuar explorando</p>
					<h2 id="explore-title">Dentro desta campanha</h2>
				</div>

				<div className={styles.routeGrid}>
					<Link className={styles.routeCard} href={`${campaignPath}/sessoes`}>
						<strong>Sessões</strong>
						<span>Memórias publicadas desta campanha.</span>
					</Link>
					<Link className={styles.routeCard} href={`${campaignPath}/mundo`}>
						<strong>Mundo</strong>
						<span>Pessoas, lugares e relações públicas desta campanha.</span>
					</Link>
					{narrativeLinks?.map((link) => (
						<Link className={styles.routeCard} href={link.href} key={link.routeKind}>
							<strong>{link.label}</strong>
							<span>Conteúdo público vinculado a esta campanha.</span>
						</Link>
					))}
				</div>

				{narrativeLinks?.length === 0 ? (
					<p className={styles.quietState}>
						Nenhum outro arquivo narrativo público foi vinculado a esta campanha ainda.
					</p>
				) : null}
			</section>
		</main>
	);
}
