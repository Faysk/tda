import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicLink as Link } from "@/components/public-link";
import { SessionShareActions } from "@/components/session-share-actions";
import { StoryMarkdown } from "@/components/story-markdown";
import { DisplayTitle, Eyebrow } from "@/components/ui";
import { sessionPublicMetadata } from "@/features/sessions/metadata";
import { formatSessionDate, sessionPublicPath, sessionPublicKey, type PublishedSession } from "@/features/sessions/model";
import { findPublishedSession, listPublishedSessions, PublishedSessionUnavailableError } from "@/features/sessions/repository";
import { sessionShareDescription } from "@/features/sessions/share";
import styles from "../../../../sessoes/[id]/page.module.css";

export const dynamic="force-dynamic";
type Params={params:Promise<{campaignSlug:string;sessionId:string}>};

export async function generateMetadata({params}:Params):Promise<Metadata>{
	const {campaignSlug,sessionId}=await params;
	const session=await findPublishedSession(campaignSlug,sessionId).catch((error)=>{if(error instanceof PublishedSessionUnavailableError)return null;throw error;});
	if(!session) notFound();
	return sessionPublicMetadata(session);
}

function NavigationCard({session,label}:{session:PublishedSession;label:string}){
	return <Link className={styles.link} href={sessionPublicPath(session)}><span className={styles.linkCopy}><span className={styles.label}>{label}</span><strong className={styles.linkTitle}>{session.title}</strong>{session.arc?<span className={styles.linkArc}>{session.arc}</span>:null}</span></Link>;
}

export default async function CampaignSession({params}:Params){
	const {campaignSlug,sessionId}=await params;
	let session:PublishedSession|null;
	try{session=await findPublishedSession(campaignSlug,sessionId);}catch(error){
		if(!(error instanceof PublishedSessionUnavailableError)) throw error;
		return <section className={styles.unavailable}><div className={styles.unavailableInner}><Eyebrow>Arquivo de sessões</Eyebrow><DisplayTitle className={styles.unavailableTitle}>Esta sessão está temporariamente indisponível.</DisplayTitle></div></section>;
	}
	if(!session) notFound();
	const archive=await listPublishedSessions(session.campaignSlug).catch(()=>null);
	const currentIndex=archive?.findIndex((item)=>sessionPublicKey(item)===sessionPublicKey(session))??-1;
	const previous=archive&&currentIndex>=0?archive[currentIndex+1]:undefined;
	const next=archive&&currentIndex>0?archive[currentIndex-1]:undefined;
	const date=formatSessionDate(session.date);
	const story=session.fullSummary||session.summary||"Resumo ainda não disponível.";
	return <article className={styles.page}>
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
				{previous?<NavigationCard session={previous} label="← Sessão anterior"/>:null}
				{next?<NavigationCard session={next} label="Próxima sessão →"/>:null}
			</nav>:null}
		</div>
	</article>;
}
