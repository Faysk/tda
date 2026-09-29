import type { Metadata } from "next";
import { OperationalPageHeader } from "@/components/operational-page-header";
import { PublicLink as Link } from "@/components/public-link";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import { TranscriptInventory } from "@/features/transcripts/statistics/inventory";
import {
	formatDuration,
	formatWords,
} from "@/features/transcripts/statistics/model";
import { getTranscriptStatistics } from "@/features/transcripts/statistics/server";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const metadata: Metadata = {
	title: "Transcrições",
	robots: { index: false, follow: false },
};

export default async function TranscriptsPage({
	searchParams,
}: {
	searchParams: Promise<{ campanha?: string | string[] }>;
}) {
	const params = await searchParams;
	const campaign =
		typeof params.campanha === "string" ? params.campanha : CAMPAIGN_SLUG;
	const result = await getTranscriptStatistics(campaign);
	if (!result.ok) {
		const nextPath =
			campaign === CAMPAIGN_SLUG
				? "/transcricoes"
				: "/transcricoes?campanha=" + encodeURIComponent(campaign);
		const state =
			result.reason === "dependency_unavailable"
				? {
						message:
							"Não foi possível consultar as transcrições agora. Tente novamente em instantes.",
						href: "/conta",
						label: "Minha conta",
					}
				: result.reason === "unauthenticated"
					? {
							message:
								"Entre com sua conta do Discord para consultar as transcrições desta campanha.",
							href: "/entrar?next=" + encodeURIComponent(nextPath),
							label: "Entrar",
						}
					: result.reason === "validation"
						? {
								message: "A campanha informada não é válida.",
								href: "/transcricoes",
								label: "Voltar às transcrições",
							}
						: result.reason === "profile_unresolved"
							? {
									message:
										"Sua conta está autenticada, mas ainda não está vinculada a um perfil com acesso a esta campanha.",
									href: "/conta",
									label: "Consultar meu acesso",
								}
							: {
									message:
										"Sua conta não tem permissão de leitura das transcrições desta campanha.",
									href: "/conta",
									label: "Consultar meu acesso",
								};
		return (
			<section className={styles.shell}>
				<OperationalPageHeader eyebrow="Transcrições" title="Transcrições" />
				<p role="status">{state.message}</p>
				<Link href={state.href}>{state.label}</Link>
			</section>
		);
	}

	const { sessions, totals } = result.value;
	const coverageIncomplete =
		totals.wordCoverage < totals.sessions ||
		totals.durationCoverage < totals.sessions;

	return (
		<section className={styles.shell}>
			<OperationalPageHeader
				eyebrow="Transcrições"
				title={
					<>
						Transcrições <span className={styles.campaign}>· {campaign}</span>
					</>
				}
			/>

			<dl className={styles.summaryStrip} aria-label="Resumo das transcrições">
				<div>
					<dt>Sessões</dt>
					<dd>{sessions.length}</dd>
				</div>
				<div>
					<dt>Palavras</dt>
					<dd>{formatWords(totals.words)}</dd>
				</div>
				<div>
					<dt>Duração registrada</dt>
					<dd>{formatDuration(totals.durationMs)}</dd>
				</div>
				<div>
					<dt>Cobertura</dt>
					<dd>
						Palavras {totals.wordCoverage}/{totals.sessions} · duração{" "}
						{totals.durationCoverage}/{totals.sessions}
					</dd>
				</div>
			</dl>

			<div className={styles.metricRow}>
				{coverageIncomplete ? (
					<p role="status" className={styles.coverageNotice}>
						Cobertura incompleta: ausência de dados não significa zero.
					</p>
				) : (
					<p className={styles.coverageComplete}>Cobertura completa.</p>
				)}
				<details className={styles.metricDetails}>
					<summary>Como é calculado?</summary>
					<p>
						Palavras do texto atual, separadas por espaços. Duração registrada
						da sessão; não é soma de falantes, tempo de fala ou estimativa de
						leitura.
					</p>
				</details>
			</div>

			{sessions.length ? (
				<TranscriptInventory sessions={sessions} />
			) : (
				<p className={styles.emptyState}>
					Nenhuma sessão disponível nesta campanha.
				</p>
			)}

			<p className={styles.accountLink}>
				<Link href="/conta">Minha conta</Link>
			</p>
		</section>
	);
}
