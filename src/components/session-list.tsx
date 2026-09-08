"use client";

import Image from "next/image";
import { type ReactNode, useMemo, useState } from "react";
import { PublicLink as Link } from "@/components/public-link";
import {
	formatArchiveDuration,
	formatArchiveNumber,
	type SessionArchiveItem,
} from "@/features/sessions/archive";
import { formatSessionDate } from "@/features/sessions/model";
import styles from "./session-list.module.css";

type ViewMode = "grid" | "list";
type SortMode = "newest" | "oldest" | "title";

const collator = new Intl.Collator("pt-BR", {
	sensitivity: "base",
	numeric: true,
});

function normalizeSearch(value: string) {
	return value
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLocaleLowerCase("pt-BR");
}

function compareDates(
	a: SessionArchiveItem,
	b: SessionArchiveItem,
	oldestFirst = false,
) {
	if (!a.date && !b.date) return 0;
	if (!a.date) return 1;
	if (!b.date) return -1;
	return oldestFirst
		? a.date.localeCompare(b.date)
		: b.date.localeCompare(a.date);
}

function SearchIcon() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<circle cx="11" cy="11" r="6.5" />
			<path d="m16 16 4 4" />
		</svg>
	);
}

function GridIcon() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<rect x="4" y="4" width="6" height="6" rx="1" />
			<rect x="14" y="4" width="6" height="6" rx="1" />
			<rect x="4" y="14" width="6" height="6" rx="1" />
			<rect x="14" y="14" width="6" height="6" rx="1" />
		</svg>
	);
}

function ListIcon() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path d="M8 6h12M8 12h12M8 18h12" />
			<circle cx="4.5" cy="6" r=".8" />
			<circle cx="4.5" cy="12" r=".8" />
			<circle cx="4.5" cy="18" r=".8" />
		</svg>
	);
}

function ClockIcon() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<circle cx="12" cy="12" r="8" />
			<path d="M12 7v5l3 2" />
		</svg>
	);
}

function PeopleIcon() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<circle cx="9" cy="9" r="3" />
			<path d="M3.5 19c.6-3.1 2.4-5 5.5-5s5 1.9 5.5 5" />
			<circle cx="17" cy="8" r="2.2" />
			<path d="M16 13.5c2.8-.3 4.2 1.4 4.5 4" />
		</svg>
	);
}

function WordsIcon() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path d="M5 6h14M5 10h14M5 14h10M5 18h7" />
		</svg>
	);
}

function ArrowIcon() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path d="M5 12h13M14 7l5 5-5 5" />
		</svg>
	);
}

function Artwork({
	session,
	sizes,
}: {
	session: SessionArchiveItem;
	sizes: string;
}) {
	const image = session.coverImage || session.heroImage;
	if (!image) {
		return (
			<div className={styles.placeholder} aria-hidden="true">
				TDA
			</div>
		);
	}
	return (
		<Image
			className={styles.image}
			src={image}
			alt=""
			fill
			sizes={sizes}
		/>
	);
}

function Metric({
	icon,
	value,
	label,
}: {
	icon: ReactNode;
	value: string;
	label: string;
}) {
	return (
		<span className={styles.metric} title={`${label}: ${value}`}>
			<span className={styles.metricIcon}>{icon}</span>
			<span>{value}</span>
			<span className={styles.srOnly}>{label}</span>
		</span>
	);
}

function GridCard({
	session,
	latest,
}: {
	session: SessionArchiveItem;
	latest: boolean;
}) {
	const href = `/sessoes/${encodeURIComponent(session.id)}`;
	const date = formatSessionDate(session.date);

	return (
		<article className={styles.card}>
			<Link className={styles.cardLink} href={href}>
				<div className={styles.media}>
					<Artwork
						session={session}
						sizes="(max-width: 720px) calc(100vw - 40px), (max-width: 1500px) 50vw, 33vw"
					/>
					<div className={styles.mediaShade} aria-hidden="true" />
					{latest ? <span className={styles.latestBadge}>Mais recente</span> : null}
					{date ? (
						<time className={styles.cardDate} dateTime={session.date}>
							{date}
						</time>
					) : null}
				</div>
				<div className={styles.cardBody}>
					<p className={styles.arc}>
						{session.arc || "Memória da campanha"}
					</p>
					<h2 className={styles.cardTitle}>{session.title}</h2>
					<p className={styles.summary}>
						{session.summary ||
							"O resumo desta sessão ainda não está disponível."}
					</p>
					<div className={styles.cardFooter}>
						<div className={styles.metrics}>
							<Metric
								icon={<ClockIcon />}
								value={formatArchiveDuration(session.durationMs)}
								label="Duração registrada"
							/>
							<Metric
								icon={<PeopleIcon />}
								value={formatArchiveNumber(session.participantCount)}
								label="Participantes"
							/>
							<Metric
								icon={<WordsIcon />}
								value={formatArchiveNumber(session.wordCount)}
								label="Palavras"
							/>
						</div>
						<span className={styles.openMark} aria-hidden="true">
							<ArrowIcon />
						</span>
					</div>
				</div>
			</Link>
		</article>
	);
}

function MobileMetric({
	label,
	value,
}: {
	label: string;
	value: string;
}) {
	return (
		<span className={styles.mobileMetric}>
			<span>{label}</span>
			<strong>{value}</strong>
		</span>
	);
}

function ListRow({ session }: { session: SessionArchiveItem }) {
	const href = `/sessoes/${encodeURIComponent(session.id)}`;
	const date = formatSessionDate(session.date);

	return (
		<article className={styles.listRow}>
			<div className={styles.sessionCell}>
				<div className={styles.listThumb} aria-hidden="true">
					<Artwork session={session} sizes="72px" />
				</div>
				<div className={styles.sessionText}>
					<Link href={href}>{session.title}</Link>
					<span className={styles.mobileDate}>
						{date || "Data não informada"}
					</span>
				</div>
			</div>
			<div className={styles.arcCell}>
				<span className={styles.mobileLabel}>Arco</span>
				<span>{session.arc || "Memória da campanha"}</span>
			</div>
			<time className={styles.dateCell} dateTime={session.date || undefined}>
				<span className={styles.mobileLabel}>Data</span>
				<span>{date || "—"}</span>
			</time>
			<div className={styles.durationCell}>
				<MobileMetric
					label="Duração"
					value={formatArchiveDuration(session.durationMs)}
				/>
			</div>
			<div className={styles.participantCell}>
				<MobileMetric
					label="Participantes"
					value={formatArchiveNumber(session.participantCount)}
				/>
			</div>
			<div className={styles.wordsCell}>
				<MobileMetric
					label="Palavras"
					value={formatArchiveNumber(session.wordCount)}
				/>
			</div>
			<p className={styles.listSummary}>
				{session.summary ||
					"O resumo desta sessão ainda não está disponível."}
			</p>
			<Link
				className={styles.rowAction}
				href={href}
				aria-label={`Abrir ${session.title}`}
			>
				<ArrowIcon />
			</Link>
		</article>
	);
}

export function SessionList({
	sessions,
}: {
	sessions: readonly SessionArchiveItem[];
}) {
	const [query, setQuery] = useState("");
	const [arc, setArc] = useState("all");
	const [sort, setSort] = useState<SortMode>("newest");
	const [view, setView] = useState<ViewMode>("grid");

	const arcs = useMemo(
		() =>
			Array.from(
				new Set(
					sessions
						.map((session) => session.arc.trim())
						.filter((value) => value.length > 0),
				),
			).sort(collator.compare),
		[sessions],
	);

	const visible = useMemo(() => {
		const needle = normalizeSearch(query.trim());
		const items = sessions.filter((session) => {
			if (arc !== "all" && session.arc !== arc) return false;
			if (!needle) return true;
			return normalizeSearch(
				`${session.title} ${session.arc} ${session.summary}`,
			).includes(needle);
		});

		return [...items].sort((a, b) => {
			if (sort === "title") return collator.compare(a.title, b.title);
			return compareDates(a, b, sort === "oldest");
		});
	}, [arc, query, sessions, sort]);

	const filtered = query.trim().length > 0 || arc !== "all";
	const latestId = sessions[0]?.id;

	return (
		<div className={styles.archive} data-session-archive>
			<div className={styles.toolbar}>
				<label className={styles.search}>
					<span className={styles.srOnly}>Buscar sessões</span>
					<SearchIcon />
					<input
						type="search"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Buscar sessão, arco ou história..."
					/>
				</label>

				<label className={styles.selectField}>
					<span className={styles.srOnly}>Filtrar por arco</span>
					<select value={arc} onChange={(event) => setArc(event.target.value)}>
						<option value="all">Todos os arcos</option>
						{arcs.map((value) => (
							<option key={value} value={value}>
								{value}
							</option>
						))}
					</select>
				</label>

				<div className={styles.toolbarEnd}>
					<label className={styles.sortField}>
						<span>Ordenar por</span>
						<select
							value={sort}
							onChange={(event) => setSort(event.target.value as SortMode)}
						>
							<option value="newest">Mais recentes</option>
							<option value="oldest">Mais antigas</option>
							<option value="title">Título A–Z</option>
						</select>
					</label>

					<fieldset className={styles.viewToggle}>
						<legend className={styles.srOnly}>Visualização</legend>
						<button
							type="button"
							className={view === "grid" ? styles.activeView : undefined}
							aria-pressed={view === "grid"}
							aria-label="Visualização em grade"
							onClick={() => setView("grid")}
						>
							<GridIcon />
						</button>
						<button
							type="button"
							className={view === "list" ? styles.activeView : undefined}
							aria-pressed={view === "list"}
							aria-label="Visualização em lista"
							onClick={() => setView("list")}
						>
							<ListIcon />
						</button>
					</fieldset>
				</div>
			</div>

			<div className={styles.resultBar}>
				<p aria-live="polite">
					<strong>{visible.length}</strong>{" "}
					{visible.length === 1 ? "sessão encontrada" : "sessões encontradas"}
				</p>
				{filtered ? (
					<button
						type="button"
						onClick={() => {
							setQuery("");
							setArc("all");
						}}
					>
						Limpar filtros
					</button>
				) : null}
			</div>

			{visible.length ? (
				view === "grid" ? (
					<div className={styles.grid} data-session-view="grid">
						{visible.map((session) => (
							<GridCard
								key={session.id}
								session={session}
								latest={session.id === latestId}
							/>
						))}
					</div>
				) : (
					<div className={styles.list} data-session-view="list">
						<div className={styles.listHeader} aria-hidden="true">
							<span>Sessão</span>
							<span>Arco</span>
							<span>Data</span>
							<span>Duração</span>
							<span>Participantes</span>
							<span>Palavras</span>
							<span>Resumo</span>
							<span />
						</div>
						<div className={styles.listBody}>
							{visible.map((session) => (
								<ListRow key={session.id} session={session} />
							))}
						</div>
					</div>
				)
			) : (
				<div className={styles.empty} role="status">
					<strong>Nenhuma sessão por aqui.</strong>
					<span>
						Tente outro termo ou limpe os filtros para ver o arquivo completo.
					</span>
				</div>
			)}
		</div>
	);
}
