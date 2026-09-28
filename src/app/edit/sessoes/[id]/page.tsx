import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicLink as Link } from "@/components/public-link";
import { ActionLink, StatusPill } from "@/components/ui";
import { requireCapability } from "@/features/auth/server";
import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
} from "@/features/edit/access/policy";
import { SessionEditorialDraftEditor } from "@/features/edit/sessions/editorial-draft-editor";
import draftStyles from "@/features/edit/sessions/editorial-draft.module.css";
import { readSessionEditorialDraft } from "@/features/edit/sessions/editorial-draft-repository";
import { readSessionPublicationContext } from "@/features/edit/sessions/session-publication-repository";
import { findEditSessionBySourceId } from "@/features/edit/sessions/repository";
import { TranscriptReader } from "@/features/edit/transcript/reader";
import { readTranscriptSnapshot } from "@/features/edit/transcript/repository";
import styles from "@/features/edit/workbench.module.css";
import { CAMPAIGN_SLUG, formatSessionDate } from "@/features/sessions/model";

export const metadata: Metadata = {
	title: "Transcrição · Edit",
	description: "Leitura privada da transcrição completa da sessão.",
};

type PageProps = Readonly<{
	params: Promise<{ id: string }>;
}>;

function UnavailableTranscript() {
	return (
		<section className={styles.locked}>
			<div className={styles.muted}>TDA / EDIT / TRANSCRIÇÃO</div>
			<h1>Transcrição indisponível</h1>
			<p className={styles.muted}>
				A fonte privada atual não pôde ser lida com integridade. Nenhum fallback
				foi aplicado.
			</p>
			<ActionLink href="/edit/sessoes" variant="tertiary">
				Voltar às sessões
			</ActionLink>
		</section>
	);
}

export default async function EditSessionPage({ params }: PageProps) {
	const { id } = await params;
	const sourceSessionId = String(id || "").trim();
	if (!sourceSessionId || sourceSessionId.length > 220) notFound();

	const accessContext = await requireCapability(
		EDIT_CAPABILITIES.transcriptRead,
		`/edit/sessoes/${encodeURIComponent(sourceSessionId)}`,
	);
	const canEdit = authorizeCampaignCapability(
		accessContext,
		EDIT_CAPABILITIES.contentEdit,
		CAMPAIGN_SLUG,
	).ok;
	const canPublish = authorizeCampaignCapability(
		accessContext,
		EDIT_CAPABILITIES.sessionPublish,
		CAMPAIGN_SLUG,
	).ok;

	let session: Awaited<ReturnType<typeof findEditSessionBySourceId>>;
	try {
		session = await findEditSessionBySourceId(CAMPAIGN_SLUG, sourceSessionId);
	} catch {
		return <UnavailableTranscript />;
	}
	if (!session) notFound();

	let snapshot: Awaited<ReturnType<typeof readTranscriptSnapshot>>;
	try {
		snapshot = await readTranscriptSnapshot({
			campaignSlug: CAMPAIGN_SLUG,
			sessionId: session.id,
		});
	} catch {
		return <UnavailableTranscript />;
	}
	if (!snapshot) return <UnavailableTranscript />;

	let draft: Awaited<ReturnType<typeof readSessionEditorialDraft>> = null;
	let publication: Awaited<ReturnType<typeof readSessionPublicationContext>> = null;
	let draftUnavailable = false;
	let publicationUnavailable = false;
	if (snapshot.source === "current_revision" && snapshot.revisionId) {
		try {
			draft = await readSessionEditorialDraft(session.id);
		} catch {
			draftUnavailable = true;
		}
		try {
			publication = await readSessionPublicationContext(session.id);
		} catch {
			publicationUnavailable = true;
		}
	}

	const sourceLabel =
		snapshot.source === "current_revision"
			? `Revisão privada atual · r${snapshot.revisionNumber ?? "?"}`
			: "Legado · transcript_segments · ainda não passou pelo handoff moderno";
	const downloadHref =
		`/api/edit/${encodeURIComponent(CAMPAIGN_SLUG)}/sessoes/${encodeURIComponent(session.sourceSessionId)}/transcript`;

	return (
		<section className={styles.shell}>
			<header className={styles.workbenchHeader}>
				<div>
					<Link className={styles.muted} href="/edit/sessoes">
						← Sessões do Edit
					</Link>
					<h1 className={styles.pageTitle}>{session.title}</h1>
					<div className={styles.sessionMeta}>
						{session.sessionDate ? (
							<span>{formatSessionDate(session.sessionDate)}</span>
						) : null}
						{session.arc ? (
							<StatusPill tone="accent">{session.arc}</StatusPill>
						) : null}
						<StatusPill
							tone={session.status === "published" ? "success" : "neutral"}
						>
							{session.status}
						</StatusPill>
					</div>
				</div>
				<div className={styles.muted}>
					<strong>{snapshot.segments.length.toLocaleString("pt-BR")}</strong>{" "}
					falas · leitura privada
				</div>
			</header>

			<div className={draftStyles.privateNotice} role="status">
				<strong>Privado no Edit</strong>
				<span>
					Transcrição e draft editorial permanecem privados. Salvar draft não
					altera a versão pública da sessão.
				</span>
			</div>

			<div className={draftStyles.sessionWorkspace}>
				<div className={draftStyles.transcriptPane}>
					<TranscriptReader
						key={session.id}
						downloadHref={downloadHref}
						editable={
							canEdit &&
							snapshot.source === "current_revision" &&
							Boolean(snapshot.revisionId)
						}
						revisionId={snapshot.revisionId}
						revisionNumber={snapshot.revisionNumber}
						segments={snapshot.segments}
						sessionId={session.id}
						sourceLabel={sourceLabel}
					/>
				</div>
				<aside className={draftStyles.editorialPane}>
					{snapshot.source !== "current_revision" ? (
						<div className={draftStyles.editorialUnavailable}>
							<strong>Draft editorial exige o handoff moderno</strong>
							<p className={styles.muted}>
								A transcrição legada continua disponível para leitura, mas não pode
								virar draft editorial silenciosamente.
							</p>
						</div>
					) : draftUnavailable ? (
						<div className={draftStyles.editorialUnavailable}>
							<strong>Draft editorial indisponível</strong>
							<p className={styles.muted}>
								A transcrição continua legível. Nenhum campo público foi alterado.
							</p>
						</div>
					) : draft ? (
						<SessionEditorialDraftEditor
							editable={canEdit}
							initial={draft}
							initialPublication={{
								currentPublicationId: publication?.currentPublicationId ?? null,
								currentVersion: publication?.currentVersion ?? 0,
							}}
							publicationAvailable={!publicationUnavailable && Boolean(publication)}
							publishable={canPublish}
							sessionId={session.id}
						/>
					) : (
						<div className={draftStyles.editorialUnavailable}>
							<strong>Draft editorial ainda não disponível</strong>
							<p className={styles.muted}>
								A sessão precisa de uma revisão de transcrição preparada antes da
								edição editorial.
							</p>
						</div>
					)}
				</aside>
			</div>
		</section>
	);
}
