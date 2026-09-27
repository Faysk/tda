import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicLink as Link } from "@/components/public-link";
import { ActionLink, StatusPill } from "@/components/ui";
import { requireCapability } from "@/features/auth/server";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import { findUnsafeEditSessionBySourceId } from "@/features/edit/sessions/repository";
import { TranscriptReader } from "@/features/edit/transcript/reader";
import { readTranscriptSnapshot } from "@/features/edit/transcript/repository";
import { isUnsafeEditEnabled } from "@/features/edit/unsafe-access";
import styles from "@/features/edit/workbench.module.css";
import { CAMPAIGN_SLUG, formatSessionDate } from "@/features/sessions/model";

export const metadata: Metadata = {
	title: "Transcrição · Edit",
	description: "Leitura privada da transcrição completa da sessão.",
};

type PageProps = Readonly<{
	params: Promise<{ id: string }>;
}>;

function DisabledEdit() {
	return (
		<section className={styles.locked}>
			<div className={styles.muted}>TDA / EDIT</div>
			<h1>Edit desativado</h1>
			<p className={styles.muted}>
				Este espaço ainda está sendo preparado para acesso com sua conta.
			</p>
		</section>
	);
}

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

	await requireCapability(
		EDIT_CAPABILITIES.transcriptRead,
		`/edit/sessoes/${encodeURIComponent(sourceSessionId)}`,
	);
	if (!isUnsafeEditEnabled()) return <DisabledEdit />;

	let session: Awaited<ReturnType<typeof findUnsafeEditSessionBySourceId>>;
	try {
		session = await findUnsafeEditSessionBySourceId(sourceSessionId);
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

			<TranscriptReader
				downloadHref={downloadHref}
				segments={snapshot.segments}
				sourceLabel={sourceLabel}
			/>
		</section>
	);
}
