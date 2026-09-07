import type { Metadata } from "next";
import Link from "next/link";
import { StatusPill } from "@/components/ui";
import { listUnsafeEditSessions } from "@/features/edit/sessions/repository";
import { isUnsafeEditEnabled } from "@/features/edit/unsafe-access";
import styles from "@/features/edit/workbench.module.css";
import { formatSessionDate } from "@/features/sessions/model";

export const metadata: Metadata = {
	title: "Edit",
	description: "Workbench administrativo do TDA.",
};

function DisabledEdit() {
	return (
		<section className={styles.locked}>
			<div className={styles.muted}>TDA / EDIT</div>
			<h1>Edit desativado</h1>
			<p className={styles.muted}>
				Este ambiente não habilitou o workbench temporário sem autenticação.
			</p>
		</section>
	);
}

export default async function EditPage() {
	if (!isUnsafeEditEnabled()) return <DisabledEdit />;

	let sessions: Awaited<ReturnType<typeof listUnsafeEditSessions>>;
	try {
		sessions = await listUnsafeEditSessions();
	} catch {
		return (
			<section className={styles.locked}>
				<div className={styles.muted}>TDA / EDIT</div>
				<h1>Banco indisponível</h1>
				<p className={styles.muted}>
					O Edit está liberado, mas a conexão server-side com o Supabase não respondeu.
				</p>
			</section>
		);
	}

	return (
		<section className={styles.shell}>
			<div className={styles.unsafeBanner} role="status">
				<strong>Modo temporário sem autenticação</strong>
				<span>Este ambiente permite writes administrativos via TDA_EDIT_UNSAFE=true.</span>
			</div>
			<header className={styles.pageHeader}>
				<div>
					<div className={styles.muted}>TDA / EDIT</div>
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
