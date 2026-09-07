import { requireCapability } from "@/features/auth/server";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionLink, StatusPill } from "@/components/ui";
import {
	countUnsafeEditTranscriptSegments,
	findUnsafeEditSessionBySourceId,
} from "@/features/edit/sessions/repository";
import { readTranscriptPage, type TranscriptCursor } from "@/features/edit/transcript/repository";
import { TranscriptEditor } from "@/features/edit/transcript/editor";
import { isUnsafeEditEnabled } from "@/features/edit/unsafe-access";
import styles from "@/features/edit/workbench.module.css";
import { CAMPAIGN_SLUG, formatSessionDate } from "@/features/sessions/model";

export const metadata: Metadata = {
	title: "Transcrição · Edit",
	description: "Editor administrativo da transcrição de sessão.",
};

type PageProps = Readonly<{
	params: Promise<{ id: string }>;
	searchParams: Promise<{
		cursorStart?: string | string[];
		cursorId?: string | string[];
		batch?: string | string[];
	}>;
}>;

const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const BATCH_SIZE = 120;

function first(value: string | string[] | undefined): string {
	return Array.isArray(value) ? value[0] || "" : value || "";
}

function parseCursor(
	startValue: string | string[] | undefined,
	idValue: string | string[] | undefined,
): TranscriptCursor | null {
	const rawStart = first(startValue);
	const id = first(idValue);
	if (!rawStart && !id) return null;
	const startMs = Number.parseInt(rawStart, 10);
	return Number.isSafeInteger(startMs) && startMs >= 0 && UUID_PATTERN.test(id)
		? { startMs, id }
		: null;
}

function parseBatch(value: string | string[] | undefined): number {
	const parsed = Number.parseInt(first(value) || "0", 10);
	return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function DisabledEdit() {
	return (
		<section className={styles.locked}>
			<div className={styles.muted}>TDA / EDIT</div>
			<h1>Edit desativado</h1>
			<p className={styles.muted}>Este espaço ainda está sendo preparado para acesso com sua conta.</p>
		</section>
	);
}

export default async function EditSessionPage({ params, searchParams }: PageProps) {
	await requireCapability(EDIT_CAPABILITIES.transcriptRead, `/edit/sessoes/${encodeURIComponent((await params).id)}`);
	if (!isUnsafeEditEnabled()) return <DisabledEdit />;
	const { id } = await params;
	const sourceSessionId = String(id || "").trim();
	if (!sourceSessionId || sourceSessionId.length > 220) notFound();

	const session = await findUnsafeEditSessionBySourceId(sourceSessionId);
	if (!session) notFound();
	const query = await searchParams;
	const cursor = parseCursor(query.cursorStart, query.cursorId);
	const batch = parseBatch(query.batch);

	let page: Awaited<ReturnType<typeof readTranscriptPage>>;
	let total = 0;
	try {
		[page, total] = await Promise.all([
			readTranscriptPage({
				campaignSlug: CAMPAIGN_SLUG,
				sessionId: session.id,
				limit: BATCH_SIZE,
				cursor,
			}),
			countUnsafeEditTranscriptSegments(session.id),
		]);
	} catch {
		return (
			<section className={styles.locked}>
				<div className={styles.muted}>TDA / EDIT / TRANSCRIÇÃO</div>
				<h1>Transcrição indisponível</h1>
				<p className={styles.muted}>Não foi possível consultar os segmentos desta sessão.</p>
				<ActionLink href="/edit" variant="tertiary">Voltar às sessões</ActionLink>
			</section>
		);
	}
	if (!page) return <DisabledEdit />;

	const editorSegments = page.segments.map((segment) => ({
		id: segment.id,
		startMs: segment.startMs,
		endMs: segment.endMs,
		text: segment.text,
		speaker:
			segment.characterName ||
			segment.speakerName ||
			segment.trackKey ||
			"Mesa",
		reviewStatus: segment.reviewStatus,
	}));
	const next = page.nextCursor;
	const nextHref = next
		? `/edit/sessoes/${encodeURIComponent(session.sourceSessionId)}?cursorStart=${next.startMs}&cursorId=${encodeURIComponent(next.id)}&batch=${batch + 1}`
		: null;
	const batchOffset = batch * BATCH_SIZE;
	const firstVisible = total && editorSegments.length ? batchOffset + 1 : 0;
	const lastVisible = Math.min(total, batchOffset + editorSegments.length);

	return (
		<section className={styles.shell}>
			<div className={styles.unsafeBanner} role="status">
				<strong>Acesso autorizado · integração em andamento</strong>
				<span>Salvar nesta tela altera a transcrição real da campanha.</span>
			</div>

			<header className={styles.workbenchHeader}>
				<div>
					<Link className={styles.muted} href="/edit">← Sessões do Edit</Link>
					<h1 className={styles.pageTitle}>{session.title}</h1>
					<div className={styles.sessionMeta}>
						{session.sessionDate ? <span>{formatSessionDate(session.sessionDate)}</span> : null}
						{session.arc ? <StatusPill tone="accent">{session.arc}</StatusPill> : null}
						<StatusPill tone={session.status === "published" ? "success" : "neutral"}>
							{session.status}
						</StatusPill>
					</div>
				</div>
				<div className={styles.muted}>
					<strong>{total.toLocaleString("pt-BR")}</strong> falas no total
				</div>
			</header>

			<TranscriptEditor
				batchOffset={batchOffset}
				segments={editorSegments}
				sessionId={session.id}
			/>

			<nav className={styles.pagination} aria-label="Paginação da transcrição">
				<div>
					{batch > 0 ? (
						<ActionLink href={`/edit/sessoes/${encodeURIComponent(session.sourceSessionId)}`} variant="tertiary">
							← Voltar ao início
						</ActionLink>
					) : null}
				</div>
				<div className={styles.paginationInfo}>
					{firstVisible.toLocaleString("pt-BR")}–{lastVisible.toLocaleString("pt-BR")} de {total.toLocaleString("pt-BR")}
				</div>
				<div>
					{nextHref ? <ActionLink href={nextHref}>Próximas {BATCH_SIZE} →</ActionLink> : null}
				</div>
			</nav>
		</section>
	);
}
