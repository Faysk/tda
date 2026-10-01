import type { Metadata } from "next";
import Image from "next/image";
import { notFound, permanentRedirect } from "next/navigation";
import { PublicLink as Link } from "@/components/public-link";
import { SessionShareActions } from "@/components/session-share-actions";
import { StoryMarkdown } from "@/components/story-markdown";
import { DisplayTitle, Eyebrow } from "@/components/ui";
import { resolvePublicCampaignRoute } from "@/features/campaigns/server";
import { sessionPublicMetadata } from "@/features/sessions/metadata";
import { resolveSessionReaderArtwork } from "@/features/sessions/reader-artwork";
import { formatSessionDate, sessionPublicPath, type PublishedSession } from "@/features/sessions/model";
import { findPublishedSession, findPublishedSessionNeighbors, PublishedSessionUnavailableError } from "@/features/sessions/repository";
import { sessionShareDescription } from "@/features/sessions/share";
import styles from "../../../../sessoes/[id]/page.module.css";

export const dynamic="force-dynamic";
type Params={params:Promise<{campaignSlug:string;sessionId:string}>};

const unavailableMetadata: Metadata = {
	title: "Sessão temporariamente indisponível",
	description: "Não foi possível consultar esta memória agora.",
	robots: { index: false, follow: false },
};

export async function generateMetadata({params}:Params):Promise<Metadata>{
	const {campaignSlug,sessionId}=await params;
	const resolved=await resolvePublicCampaignRoute(campaignSlug).catch(()=>({
		ok:false,
		reason:"dependency_unavailable",
	} as const));
	if(!resolved.ok){
		if(resolved.reason==="not_found") notFound();
		return unavailableMetadata;
	}
	const session=await findPublishedSession(resolved.campaign.routeKey,sessionId).catch((error)=>{
		if(error instanceof PublishedSessionUnavailableError)return undefined;
		throw error;
	});
	if(session===undefined) return unavailableMetadata;
	if(!session) notFound();
	return sessionPublicMetadata(session);
}

function UnavailableSession(){
	return <section className={styles.unavailable}><div className={styles.unavailableInner}><Eyebrow>Arquivo de sessões</Eyebrow><DisplayTitle className={styles.unavailableTitle}>Esta sessão está temporariamente indisponível.</DisplayTitle></div></section>;
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
	const resolved=await resolvePublicCampaignRoute(campaignSlug).catch(()=>({
		ok:false,
		reason:"dependency_unavailable",
	} as const));
	if(!resolved.ok){
		if(resolved.reason==="not_found") notFound();
		return <UnavailableSession/>;
	}
	if(!resolved.canonical){
		permanentRedirect(
			`/campanhas/${encodeURIComponent(resolved.campaign.routeKey)}/sessoes/${encodeURIComponent(sessionId)}`,
		);
	}
	let session:PublishedSession|null;
	try{session=await findPublishedSession(resolved.campaign.routeKey,sessionId);}catch(error){
		if(!(error instanceof PublishedSessionUnavailableError)) throw error;
		return <UnavailableSession/>;
	}
	if(!session) notFound();
	const neighbors=await findPublishedSessionNeighbors(session).catch(()=>null);
	const previous=neighbors?.previous;
	const next=neighbors?.next;
	const date=formatSessionDate(session.date);
	const story=session.fullSummary||session.summary||"Resumo ainda não disponível.";
	const artwork=resolveSessionReaderArtwork(session);
	const heroClassName=artwork.url ? `${styles.hero} ${styles.heroWithArt}` : styles.hero;
	return <article className={styles.page}>
		<header className={heroClassName} data-session-reader-hero data-session-artwork-source={artwork.source}>
			{artwork.url ? <><Image className={styles.art} src={artwork.url} alt="" fill sizes="100vw" priority/><div className={styles.overlay} aria-hidden="true"/></> : null}
			<div className={styles.heroInner}><div className={styles.content}>
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
