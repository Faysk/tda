import type { Metadata } from "next";
import { PublicLink as Link } from "@/components/public-link";
import { StatusPill } from "@/components/ui";
import { requireCapability } from "@/features/auth/server";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import { listUnsafeEditSessions } from "@/features/edit/sessions/repository";
import { isUnsafeEditEnabled } from "@/features/edit/unsafe-access";
import styles from "@/features/edit/workbench.module.css";
import { formatSessionDate } from "@/features/sessions/model";

export const metadata: Metadata = {
	title: "Sessões · Edit",
	description: "Sessões disponíveis para revisão administrativa.",
};

function DisabledEdit() {
	return (
		<section className={styles.locked}>
			<div className={styles.muted}>TDA / EDIT / SESSÕES</div>
			<h1>Edit desativado</h1>
			<p className={styles.muted}>
				A consulta administrativa das sessões está desativada neste ambiente.
			</p>
			<Link href="/edit">← Voltar ao Edit</Link>
		</section>
	);
}

export default async function EditSessionsPage() {
	await requireCapability(EDIT_CAPABILITIES.transcriptRead, "/edit/sessoes");
	if (!isUnsafeEditEnabled()) return <DisabledEdit />;

	let sessions: Awaited<ReturnType<typeof listUnsafeEditSessions>>;
	try {
		sessions = await listUnsafeEditSessions();
	} catch {
		return (
			<section className={styles.locked}>
				<div className={styles.muted}>TDA / EDIT / SESSÕES</div>
				<h1>Banco indisponível</h1>
				<p className={styles.muted}>
					A conexão server-side com o Supabase não respondeu.
				</p>
				<Link href="/edit">← Voltar ao Edit</Link>
			</section>
			);
	}

	return (
		<section className={styles.shell}>
			<header className={styles.pageHeader}>
				<div>
					<Link className={styles.muted} href="/edit">
						← Visão geral do Edit
					</Link>
					<h1 className={styles.pageTitle}>Sessões</h1>
				</div>
				<div className={styles.muted}>{sessions.length} sessões disponíveis</div>
			</header>

			<div className={styles.sessionGrid}>
				{sessions.map((session) => (
					<Link
						className={styles.sessionCard}
						href={`/edit/sessoes/${encodeURIComponent(session.sourceSessionId)}`}
						key={session.id}
					>
						<div className={styles.sessionMeta}>
							<StatusPill tone={session.status === "published" ? "success" : "neutral"}>
								{session.status}
							</StatusPill>
							{session.arc ? <StatusPill tone="accent">{session.arc}</StatusPill> : null}
						</div>
						<h2 className={styles.sessionTitle}>{session.title}</h2>
						<div className={styles.muted}>
							{session.sessionDate ? formatSessionDate(session.sessionDate) : "Sem data"}
						</div>
						<div className={styles.sessionId}>{session.sourceSessionId}</div>
					</Link>
				))}
			</div>
		</section>
	);
}
