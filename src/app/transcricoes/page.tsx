import type { Metadata } from "next";
import Link from "next/link";
import { CAMPAIGN_SLUG, formatSessionDate } from "@/features/sessions/model";
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
				: `/transcricoes?campanha=${encodeURIComponent(campaign)}`;
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
							href: `/entrar?next=${encodeURIComponent(nextPath)}`,
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
				<h1>Transcrições</h1>
				<p role="status">{state.message}</p>
				<Link href={state.href}>{state.label}</Link>
			</section>
		);
	}
	const { sessions, totals } = result.value;
	return (
		<section className={styles.shell}>
			<header>
				<p className={styles.eyebrow}>TDA · TRANSCRIÇÕES</p>
				<h1>Palavras e tempo</h1>
				<p>
					Totais de todas as sessões acessíveis da campanha{" "}
					<strong>{campaign}</strong>.
				</p>
				<p className={styles.muted}>
					Atualizados a cada consulta. Recarregue esta página após editar ou
					importar uma transcrição.
				</p>
			</header>
			<dl className={styles.summary} aria-label="Totais das transcrições">
				<div>
					<dt>Sessões acessíveis</dt>
					<dd>{sessions.length}</dd>
				</div>
				<div>
					<dt>Palavras conhecidas</dt>
					<dd>{formatWords(totals.words)}</dd>
					<p>
						{totals.wordCoverage} de {totals.sessions} sessões com contagem
					</p>
				</div>
				<div>
					<dt>Duração registrada conhecida</dt>
					<dd>{formatDuration(totals.durationMs)}</dd>
					<p>
						{totals.durationCoverage} de {totals.sessions} sessões com duração
					</p>
				</div>
			</dl>
			{totals.wordCoverage < totals.sessions ||
			totals.durationCoverage < totals.sessions ? (
				<p role="status" className={styles.notice}>
					Cobertura incompleta: os totais somam somente os valores informados.
					Ausência de dados não significa zero.
				</p>
			) : null}
			<p className={styles.muted}>
				Palavras do texto atual, separadas por espaços. Duração registrada da
				sessão; não é soma de falantes, tempo de fala ou estimativa de leitura.
			</p>
			{sessions.length ? (
				<div className={styles.grid}>
					{sessions.map((session) => (
						<article className={styles.card} key={session.id}>
							<h2>{session.title}</h2>
							<p className={styles.muted}>
								{session.date
									? formatSessionDate(session.date)
									: "Data não informada"}
							</p>
							<dl>
								<div>
									<dt>Palavras</dt>
									<dd>{formatWords(session.words)}</dd>
								</div>
								<div>
									<dt>Duração registrada</dt>
									<dd>{formatDuration(session.durationMs)}</dd>
								</div>
							</dl>
						</article>
					))}
				</div>
			) : (
				<p>Nenhuma sessão disponível nesta campanha.</p>
			)}
			<Link href="/conta">Minha conta</Link>
		</section>
	);
}
