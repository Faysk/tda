import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SessionList } from "@/components/session-list";
import { buildPublicMetadata } from "@/config/public-metadata";
import { formatArchiveDate, formatArchiveNumber, summarizeSessionArchive } from "@/features/sessions/archive";
import { listPublishedSessionArchive } from "@/features/sessions/repository";
import styles from "../../../sessoes/page.module.css";

export const dynamic = "force-dynamic";
type Params={params:Promise<{campaignSlug:string}>};

export async function generateMetadata({params}:Params):Promise<Metadata>{
	const {campaignSlug}=await params;
	const sessions=await listPublishedSessionArchive(campaignSlug).catch(()=>null);
	const campaign=sessions?.[0];
	if(!campaign) return buildPublicMetadata({title:"Sessões",description:"Arquivo público de sessões da campanha.",pathname:`/campanhas/${encodeURIComponent(campaignSlug)}/sessoes`});
	return buildPublicMetadata({title:`Sessões — ${campaign.campaignName}`,description:`Arquivo público de sessões de ${campaign.campaignName}.`,pathname:`/campanhas/${encodeURIComponent(campaign.campaignSlug)}/sessoes`});
}

export default async function CampaignSessions({params}:Params){
	const {campaignSlug}=await params;
	let sessions:Awaited<ReturnType<typeof listPublishedSessionArchive>>;
	try{sessions=await listPublishedSessionArchive(campaignSlug);}catch{return <p className={styles.state}>Não foi possível carregar as sessões.</p>;}
	if(sessions===null) return <p className={styles.state}>Estamos preparando o arquivo da campanha.</p>;
	if(!sessions.length) notFound();
	const campaign=sessions[0]!;
	const summary=summarizeSessionArchive(sessions);
	return <div className={styles.page} data-layout-family="editorial" data-layout-role="expansive">
		<section className={styles.hero} aria-labelledby="archive-title"><div className={styles.backdropShade} aria-hidden="true"/><div className={styles.heroInner}>
			<header className={styles.heroCopy}><p className={styles.eyebrow}>Arquivo da campanha</p><h1 className={styles.title} id="archive-title">{campaign.campaignName}</h1><p>Sessões e memórias publicadas desta campanha.</p></header>
			<dl className={styles.stats} aria-label="Resumo público do arquivo">
				<div className={styles.stat}><dt>memórias publicadas</dt><dd>{formatArchiveNumber(summary.sessions)}</dd></div>
				<div className={styles.stat}><dt>arcos registrados</dt><dd>{formatArchiveNumber(summary.arcs)}</dd></div>
				<div className={styles.stat}><dt>primeira memória</dt><dd>{formatArchiveDate(summary.firstDate)}</dd></div>
				<div className={styles.stat}><dt>última memória</dt><dd>{formatArchiveDate(summary.latestDate)}</dd></div>
			</dl>
		</div></section>
		<section className={styles.archive} aria-label="Sessões publicadas"><div className={styles.archiveRail}><SessionList sessions={sessions}/></div></section>
	</div>;
}
