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
import { readSessionEditorialDraft } from "@/features/edit/sessions/editorial-draft-repository";
import { SessionTranscriptReader } from "@/features/edit/sessions/transcript-reader";
import { readPreparedSessionTranscript } from "@/features/edit/sessions/transcript-revision";
import styles from "@/features/edit/workbench.module.css";
import { CAMPAIGN_SLUG, formatSessionDate } from "@/features/sessions/model";

export const metadata: Metadata = {
	title: "Sessão · Edit",
	description: "Workspace privado de transcrição e preparação editorial da sessão.",
};

type PageProps = Readonly<{
	params: Promise<{ id: string }>;
}>;

export default async function EditSessionPage({ params }: PageProps) {
	const { id } = await params;
	const sourceSessionId = String(id || "").trim();
	if (!sourceSessionId || sourceSessionId.length > 220) notFound();

	const accessContext = await requireCapability(
		EDIT_CAPABILITIES.transcriptRead,
		"/edit/sessoes/" + encodeURIComponent(sourceSessionId),
	);
	const canEdit = authorizeCampaignCapability(
		accessContext,
		EDIT_CAPABILITIES.contentEdit,
		CAMPAIGN_SLUG,
	).ok;

	let snapshot: Awaited<ReturnType<typeof readPreparedSessionTranscript>>;
	try {
		snapshot = await readPreparedSessionTranscript(sourceSessionId);
	} catch {
		return (
			<section className={styles.locked}>
				<div className={styles.muted}>TDA / EDIT / TRANSCRIÇÃO</div>
				<h1>Transcrição indisponível</h1>
				<p className={styles.muted}>
					Não foi possível ler a revisão privada atual desta sessão. O sistema
					não usa a transcrição legada como fallback silencioso.
				</p>
				<ActionLink href="/edit/sessoes" variant="tertiary">
					Voltar às sessões
				</ActionLink>
			</section>
		);
	}
	if (!snapshot) notFound();

	let draft: Awaited<ReturnType<typeof readSessionEditorialDraft>> = null;
	let draftUnavailable = false;
	try {
		draft = await readSessionEditorialDraft(snapshot.sessionId);
	} catch {
		draftUnavailable = true;
	}

	return (
		<section className={styles.shell}>
			<header className={styles.workbenchHeader}>
				<div>
					<Link className={styles.muted} href="/edit/sessoes">
						← Sessões do Edit
					</Link>
					<h1 className={styles.pageTitle}>{snapshot.title}</h1>
					<div className={styles.sessionMeta}>
						{snapshot.sessionDate ? (
							<span>{formatSessionDate(snapshot.sessionDate)}</span>
						) : null}
						{snapshot.arc ? (
							<StatusPill tone="accent">{snapshot.arc}</StatusPill>
						) : null}
						<StatusPill tone="neutral">
							Transcrição privada · r{snapshot.revisionNumber}
						</StatusPill>
						{snapshot.status === "published" ? (
							<StatusPill tone="success">Sessão pública</StatusPill>
						) : (
							<StatusPill tone="neutral">Sessão ainda privada</StatusPill>
						)}
					</div>
				</div>
				<div className={styles.readerHeaderActions}>
					<div className={styles.muted}>
						<strong>
							{snapshot.segments.length.toLocaleString("pt-BR")}
						</strong>{" "}
						falas · revisão atual
					</div>
					<ActionLink
						href={
							"/api/edit/sessions/" +
							encodeURIComponent(snapshot.sourceSessionId) +
							"/transcript"
						}
						variant="tertiary"
					>
						Baixar transcrição (.md)
					</ActionLink>
				</div>
			</header>

			<div className={styles.privateNotice} role="status">
				<strong>Privado no Edit</strong>
				<span>
					Transcrição e draft editorial permanecem privados. Salvar draft não
					altera a versão pública da sessão.
				</span>
			</div>

			<div className={styles.sessionWorkspace}>
				<div className={styles.transcriptPane}>
					<SessionTranscriptReader segments={snapshot.segments} />
				</div>
				<aside className={styles.editorialPane}>
					{draftUnavailable ? (
						<div className={styles.editorialUnavailable}>
							<strong>Draft editorial indisponível</strong>
							<p className={styles.muted}>
								A transcrição continua legível. Nenhum campo público foi
								alterado.
							</p>
						</div>
					) : draft ? (
						<SessionEditorialDraftEditor
							editable={canEdit}
							initial={draft}
							sessionId={snapshot.sessionId}
						/>
					) : (
						<div className={styles.editorialUnavailable}>
							<strong>Draft editorial ainda não disponível</strong>
							<p className={styles.muted}>
								Esta sessão precisa de uma revisão de transcrição preparada.
							</p>
						</div>
					)}
				</aside>
			</div>
		</section>
	);
}
