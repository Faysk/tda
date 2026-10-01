import type { Metadata } from "next";
import { cache } from "react";
import { resolvePublicCampaignRoute } from "@/features/campaigns/repository";
import Image from "next/image";
import { notFound, permanentRedirect } from "next/navigation";
import { PublicLink as Link } from "@/components/public-link";
import { SessionShareActions } from "@/components/session-share-actions";
import { StoryMarkdown } from "@/components/story-markdown";
import { DisplayTitle, Eyebrow } from "@/components/ui";
import { sessionPublicMetadata } from "@/features/sessions/metadata";
import { formatSessionDate, sessionPublicPath, type PublishedSession } from "@/features/sessions/model";
import { findPublishedSession, findAdjacentPublishedSessions, PublishedSessionUnavailableError } from "@/features/sessions/repository";
import { sessionShareDescription } from "@/features/sessions/share";
import styles from "../../../../sessoes/[id]/page.module.css";

export const dynamic="force-dynamic";
type Params={params:Promise<{campaignSlug:string;sessionId:string}>};

const readSessionRoute = cache(async (campaignSlug: string, sessionId: string) => {
 const resolved = await resolvePublicCampaignRoute(campaignSlug);
 if (!resolved.ok) {
  if (resolved.reason === "not_found") return null;
  throw new PublishedSessionUnavailableError();
 }
 if (!resolved.canonical) permanentRedirect(`/campanhas/${encodeURIComponent(resolved.campaign.routeKey)}/sessoes/${encodeURIComponent(sessionId)}`);
 return findPublishedSession(resolved.campaign.routeKey, sessionId);
});

export async function generateMetadata({params}:Params):Promise<Metadata>{
 const {campaignSlug,sessionId}=await params;
 let session: PublishedSession | null;
 try { session = await readSessionRoute(campaignSlug, sessionId); }
 catch (error) {
  if (!(error instanceof PublishedSessionUnavailableError)) throw error;
  return { title: "Sessão temporariamente indisponível", robots: { index: false } };
 }
 if (!session) notFound();
 return sessionPublicMetadata(session);
}

function NavigationCard({
	session,
	direction,
}: {
	session: PublishedSession;
	direction: "previous" | "next";
}) {
	const image = session.coverImage || session.heroImage;
	const isNext = direction === "next";
	return (
		<Link
			className={`${styles.link}${isNext ? ` ${styles.next}` : ""}`}
			href={sessionPublicPath(session)}
		>
			<span className={styles.linkMedia} aria-hidden="true">
				{image ? (
					<Image
						className={styles.linkImage}
						src={image}
						alt=""
						fill
						sizes="(max-width: 700px) 96px, 148px"
					/>
				) : (
					<span className={styles.linkFallback}>TDA</span>
				)}
				<span className={styles.linkShade} />
			</span>
			<span className={styles.linkCopy}>
				<span className={styles.label}>
					{isNext ? "Próxima sessão →" : "← Sessão anterior"}
				</span>
				<strong className={styles.linkTitle}>{session.title}</strong>
				{session.arc ? <span className={styles.linkArc}>{session.arc}</span> : null}
			</span>
		</Link>
	);
}

export default async function CampaignSession({params}:Params){
	const {campaignSlug,sessionId}=await params;
	let session:PublishedSession|null;
	try{session=await readSessionRoute(campaignSlug,sessionId);}catch(error){
		if(!(error instanceof PublishedSessionUnavailableError)) throw error;
		return <section className={styles.unavailable} data-public-content-state="unavailable"><div className={styles.unavailableInner}><Eyebrow>Arquivo de sessões</Eyebrow><DisplayTitle className={styles.unavailableTitle}>Esta sessão está temporariamente indisponível.</DisplayTitle></div></section>;
	}
	if(!session) notFound();
	const {previous, next} = await findAdjacentPublishedSessions(session).catch(() => ({previous: undefined, next: undefined}));
	const date=formatSessionDate(session.date);
	const story=session.fullSummary||session.summary||"Resumo ainda não disponível.";
	return <article className={styles.page} data-public-content-state="ready">
		<header className={styles.hero} data-session-reader-hero><div className={styles.heroInner}><div className={styles.content}>
			<Link className={styles.back} href={`/campanhas/${encodeURIComponent(session.campaignSlug)}/sessoes`}>← <span>Arquivo de {session.campaignName}</span></Link>
			<Eyebrow className={styles.eyebrow}>{session.campaignName} · {session.arc||"Memória da campanha"}</Eyebrow>
			<DisplayTitle className={styles.title}>{session.title}</DisplayTitle>
			{date?<time className={styles.date} dateTime={session.date}>{date}</time>:null}
		</div></div></header>
		<div className={styles.body} data-session-reading>
			<div className={styles.readingIntro}><span className={styles.chapterMark} aria-hidden="true">◆</span><SessionShareActions title={session.title} description={sessionShareDescription(session.summary,session.title)}/></div>
			<StoryMarkdown source={story} title={session.title}/>
			{previous||next?<nav className={styles.pagination} aria-label="Navegação entre sessões">
				{previous?<NavigationCard session={previous} direction="previous"/>:null}
				{next?<NavigationCard session={next} direction="next"/>:null}
			</nav>:null}
		</div>
	</article>;
}
