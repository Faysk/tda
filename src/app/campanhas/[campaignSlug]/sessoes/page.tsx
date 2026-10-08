import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { SessionList } from "@/components/session-list";
import { buildPublicMetadata } from "@/config/public-metadata";
import { resolvePublicCampaignRoute } from "@/features/campaigns/server";
import {
	formatArchiveDate,
	formatArchiveNumber,
	summarizeSessionArchive,
} from "@/features/sessions/archive";
import {
	LEGACY_CAMPAIGN_NAME,
	LEGACY_CAMPAIGN_PUBLIC_SLUG,
} from "@/features/sessions/model";
import { listPublishedSessionArchive } from "@/features/sessions/repository";
import styles from "../../../sessoes/page.module.css";

export const dynamic = "force-dynamic";

type Props = {
	params: Promise<{ campaignSlug: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
	const { campaignSlug } = await params;
	const resolved = await resolvePublicCampaignRoute(campaignSlug);

	if (resolved.ok) {
		return buildPublicMetadata({
			title: `Sessões — ${resolved.campaign.name}`,
			description:
				resolved.campaign.description ||
				`Arquivo público de sessões de ${resolved.campaign.name}.`,
			pathname: `/campanhas/${resolved.campaign.routeKey}/sessoes`,
			image: resolved.campaign.coverImage
				? {
						url: resolved.campaign.coverImage,
						alt: `Capa da campanha ${resolved.campaign.name}`,
						verification: "verified-public",
					}
				: undefined,
		});
	}

	if (
		resolved.reason === "dependency_unavailable" &&
		campaignSlug === LEGACY_CAMPAIGN_PUBLIC_SLUG
	) {
		return buildPublicMetadata({
			title: `Sessões — ${LEGACY_CAMPAIGN_NAME}`,
			description: `Arquivo público de sessões de ${LEGACY_CAMPAIGN_NAME}.`,
			pathname: `/campanhas/${LEGACY_CAMPAIGN_PUBLIC_SLUG}/sessoes`,
		});
	}

	return buildPublicMetadata({
		title: "Sessões",
		description: "Arquivo público de sessões da campanha.",
		pathname: `/campanhas/${encodeURIComponent(campaignSlug)}/sessoes`,
	});
}

export default async function CampaignSessionsPage({ params }: Props) {
	const { campaignSlug } = await params;
	const resolved = await resolvePublicCampaignRoute(campaignSlug);

	let routeKey = campaignSlug;
	let campaignName = LEGACY_CAMPAIGN_NAME;
	let campaignDescription: string | null = null;
	let campaignCoverImage: string | null = null;

	if (resolved.ok) {
		if (!resolved.canonical) {
			redirect(`/campanhas/${resolved.campaign.routeKey}/sessoes`);
		}
		routeKey = resolved.campaign.routeKey;
		campaignName = resolved.campaign.name;
		campaignDescription = resolved.campaign.description;
		campaignCoverImage = resolved.campaign.coverImage;
	} else if (resolved.reason === "not_found") {
		notFound();
	} else if (campaignSlug !== LEGACY_CAMPAIGN_PUBLIC_SLUG) {
		return (
			<section className={styles.page}>
				<p className={styles.state} role="status">
					Não foi possível carregar as sessões desta campanha agora.
				</p>
			</section>
		);
	}

	let sessions: Awaited<ReturnType<typeof listPublishedSessionArchive>>;
	try {
		sessions = await listPublishedSessionArchive(routeKey);
	} catch {
		return (
			<section className={styles.page}>
				<p className={styles.state} role="status">
					Não foi possível carregar as sessões desta campanha agora.
				</p>
			</section>
		);
	}

	if (sessions === null) {
		return (
			<section className={styles.page}>
				<p className={styles.state} role="status">
					Estamos preparando o arquivo da campanha.
				</p>
			</section>
		);
	}

	if (!resolved.ok && sessions[0]) {
		campaignName = sessions[0].campaignName;
	}

	const summary = summarizeSessionArchive(sessions);
	const sessionArtwork = sessions.find(
		(session) => session.coverImage || session.heroImage,
	);
	const campaignArtwork =
		campaignCoverImage ||
		sessionArtwork?.coverImage ||
		sessionArtwork?.heroImage ||
		null;
	const artworkSource = campaignCoverImage
		? "campaign-cover"
		: campaignArtwork
			? "session-artwork"
			: "fallback";
	const campaignPath = `/campanhas/${encodeURIComponent(routeKey)}`;

	return (
		<div
			className={styles.page}
			data-layout-family="editorial"
			data-layout-role="expansive"
			data-session-archive-scope="campaign"
			data-campaign-route={routeKey}
		>
			<section
				className={`${styles.hero} ${styles.scopedHero}`}
				aria-labelledby="archive-title"
				data-session-archive-hero
				data-has-artwork={campaignArtwork ? "true" : "false"}
				data-campaign-artwork-source={artworkSource}
			>
				{campaignArtwork ? (
					<div className={styles.backdrop} aria-hidden="true">
						<Image
							className={styles.backdropImage}
							src={campaignArtwork}
							alt=""
							fill
							sizes="100vw"
							priority
						/>
					</div>
				) : null}
				<div className={styles.backdropShade} aria-hidden="true" />
				<div className={styles.heroInner}>
					<header className={styles.heroCopy}>
						<nav
							className={styles.scopeBreadcrumb}
							aria-label="Contexto da campanha"
						>
							<Link href="/campanhas">Campanhas</Link>
							<span aria-hidden="true">›</span>
							<Link href={campaignPath}>{campaignName}</Link>
							<span aria-hidden="true">›</span>
							<span aria-current="page">Sessões</span>
						</nav>
						<p className={styles.eyebrow}>Campanha · arquivo de sessões</p>
						<h1 className={styles.title} id="archive-title">
							{campaignName}
						</h1>
						<p>
							{campaignDescription ||
								"Sessões e memórias publicadas desta campanha."}
						</p>
						<nav
							className={styles.scopeActions}
							aria-label={`Explorar ${campaignName}`}
						>
							<Link
								className={styles.scopeAction}
								href="/campanhas/sessoes"
							>
								Arquivo global
							</Link>
							<Link
								className={styles.scopeAction}
								href={`${campaignPath}/mundo`}
							>
								Mundo
							</Link>
							<Link
								className={styles.scopeAction}
								href={`${campaignPath}/personagens`}
							>
								Personagens
							</Link>
							<Link
								className={styles.scopeAction}
								href={`${campaignPath}/lugares`}
							>
								Lugares
							</Link>
						</nav>
					</header>

					<dl
						className={styles.stats}
						aria-label={`Resumo da campanha ${campaignName}`}
					>
						<div className={styles.stat}>
							<dt>memórias desta campanha</dt>
							<dd>{formatArchiveNumber(summary.sessions)}</dd>
						</div>
						<div className={styles.stat}>
							<dt>arcos desta campanha</dt>
							<dd>{formatArchiveNumber(summary.arcs)}</dd>
						</div>
						<div className={styles.stat}>
							<dt>primeira memória desta campanha</dt>
							<dd>{formatArchiveDate(summary.firstDate)}</dd>
						</div>
						<div className={styles.stat}>
							<dt>última memória desta campanha</dt>
							<dd>{formatArchiveDate(summary.latestDate)}</dd>
						</div>
					</dl>
				</div>
			</section>

			<section
				className={styles.archive}
				aria-label={`Sessões publicadas de ${campaignName}`}
			>
				<div className={styles.archiveRail} data-session-archive-rail>
					{sessions.length === 0 ? (
						<div className={styles.state}>
							<h2>Nenhuma sessão publicada ainda</h2>
							<p>
								Quando esta campanha publicar sua primeira memória, ela
								aparece aqui.
							</p>
						</div>
					) : (
						<SessionList sessions={sessions} />
					)}
				</div>
			</section>
		</div>
	);
}
