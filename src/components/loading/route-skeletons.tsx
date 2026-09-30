import type { ReactNode } from "react";
import styles from "./route-skeletons.module.css";

const CARDS = ["card-1", "card-2", "card-3", "card-4", "card-5", "card-6", "card-7", "card-8"] as const;
const ROWS = ["row-1", "row-2", "row-3", "row-4", "row-5", "row-6", "row-7"] as const;
const LINES = [
	{ id: "line-1", short: false },
	{ id: "line-2", short: false },
	{ id: "line-3", short: true },
	{ id: "line-4", short: false },
	{ id: "line-5", short: false },
	{ id: "line-6", short: true },
	{ id: "line-7", short: false },
	{ id: "line-8", short: false },
	{ id: "line-9", short: true },
] as const;
const NODES = [
	"worldNode1",
	"worldNode2",
	"worldNode3",
	"worldNode4",
	"worldNode5",
	"worldNode6",
	"worldNode7",
] as const;
const METRICS = ["metric-1", "metric-2", "metric-3", "metric-4"] as const;
const STAGES = ["stage-1", "stage-2", "stage-3", "stage-4", "stage-5"] as const;

function cx(...values: Array<string | false | null | undefined>) {
	return values.filter(Boolean).join(" ");
}

export function SkeletonBlock({ className }: Readonly<{ className?: string }>) {
	return (
		<span
			className={cx(styles.skeleton, className)}
			data-skeleton-block="true"
			aria-hidden="true"
		/>
	);
}

function LoadingStatus({ label }: Readonly<{ label: string }>) {
	return (
		<p
			className={styles.visuallyHidden}
			data-route-loading-status="true"
			role="status"
			aria-live="polite"
		>
			{label}
		</p>
	);
}

function LoadingShell({
	children,
	family,
	kind,
	label,
}: Readonly<{
	children: ReactNode;
	family: "cinematic" | "editorial" | "workspace" | "world" | "compact";
	kind: string;
	label: string;
}>) {
	return (
		<>
			<LoadingStatus label={label} />
			<section
				className={cx(styles.shell, styles[family])}
				data-route-skeleton={kind}
				data-loading-family={family}
				data-global-loading="off"
				aria-busy="true"
				aria-label={label}
			>
				{children}
			</section>
		</>
	);
}

export function CinematicRouteLoading({
	label = "Carregando história",
}: Readonly<{ label?: string }>) {
	return (
		<LoadingShell family="cinematic" kind="cinematic" label={label}>
			<div className={styles.cinematicStage} aria-hidden="true">
				<div className={styles.cinematicShade} />
				<div className={styles.cinematicCopy}>
					<SkeletonBlock className={styles.cinematicEyebrow} />
					<SkeletonBlock className={styles.cinematicTitle} />
					<SkeletonBlock className={styles.cinematicText} />
					<SkeletonBlock className={styles.cinematicTextShort} />
					<SkeletonBlock className={styles.cinematicAction} />
				</div>
			</div>
		</LoadingShell>
	);
}

export function EditorialListRouteLoading({
	label = "Carregando conteúdo",
}: Readonly<{ label?: string }>) {
	return (
		<LoadingShell family="editorial" kind="editorial-list" label={label}>
			<header className={styles.editorialHeader}>
				<div className={styles.headerCopy}>
					<SkeletonBlock className={styles.eyebrow} />
					<SkeletonBlock className={styles.title} />
					<SkeletonBlock className={styles.introWide} />
					<SkeletonBlock className={styles.intro} />
				</div>
				<div className={styles.headerMeta}>
					<SkeletonBlock className={styles.metaPill} />
					<SkeletonBlock className={styles.metaPillShort} />
				</div>
			</header>

			<div className={styles.filterRow} aria-hidden="true">
				<SkeletonBlock className={styles.search} />
				<SkeletonBlock className={styles.control} />
				<SkeletonBlock className={styles.control} />
				<SkeletonBlock className={styles.action} />
			</div>

			<div className={styles.cardGrid} aria-hidden="true">
				{CARDS.map((item) => (
					<article className={styles.card} key={item}>
						<SkeletonBlock className={styles.cardMedia} />
						<div className={styles.cardCopy}>
							<SkeletonBlock className={styles.cardTitle} />
							<SkeletonBlock className={styles.cardText} />
							<SkeletonBlock className={styles.cardMeta} />
						</div>
					</article>
				))}
			</div>
		</LoadingShell>
	);
}

export function EditorialDetailRouteLoading({
	label = "Carregando detalhe",
}: Readonly<{ label?: string }>) {
	return (
		<LoadingShell family="editorial" kind="editorial-detail" label={label}>
			<div className={styles.detailHero} aria-hidden="true">
				<div className={styles.detailHeroCopy}>
					<SkeletonBlock className={styles.backLink} />
					<SkeletonBlock className={styles.eyebrow} />
					<SkeletonBlock className={styles.detailTitle} />
					<SkeletonBlock className={styles.detailMeta} />
				</div>
			</div>
			<div className={styles.detailBody} aria-hidden="true">
				<SkeletonBlock className={styles.bodyLead} />
				{LINES.map((item) => (
					<SkeletonBlock
						className={item.short ? styles.bodyLineShort : styles.bodyLine}
						key={item.id}
					/>
				))}
			</div>
		</LoadingShell>
	);
}

export type WorkspaceLoadingVariant = "table" | "library" | "editor" | "processing";

export function WorkspaceRouteLoading({
	label = "Carregando workspace",
	variant = "table",
}: Readonly<{ label?: string; variant?: WorkspaceLoadingVariant }>) {
	return (
		<LoadingShell family="workspace" kind={`workspace-${variant}`} label={label}>
			<header className={styles.workspaceHeader}>
				<div>
					<SkeletonBlock className={styles.eyebrow} />
					<SkeletonBlock className={styles.workspaceTitle} />
				</div>
				<SkeletonBlock className={styles.workspaceHeaderAction} />
			</header>

			<div className={styles.workspaceToolbar} aria-hidden="true">
				<SkeletonBlock className={styles.workspaceSearch} />
				<SkeletonBlock className={styles.workspaceControl} />
				<SkeletonBlock className={styles.workspaceControl} />
				<SkeletonBlock className={styles.workspaceButton} />
			</div>

			{variant === "library" ? (
				<div className={styles.libraryList} aria-hidden="true">
					{ROWS.slice(0, 5).map((item) => (
						<article className={styles.libraryRow} key={item}>
							<SkeletonBlock className={styles.libraryThumb} />
							<div className={styles.libraryPrimary}>
								<SkeletonBlock className={styles.libraryTitle} />
								<div className={styles.libraryMeta}>
									<SkeletonBlock className={styles.libraryPill} />
									<SkeletonBlock className={styles.libraryPillShort} />
								</div>
								<SkeletonBlock className={styles.librarySecondary} />
							</div>
							<SkeletonBlock className={styles.libraryOpen} />
						</article>
					))}
				</div>
			) : variant === "editor" ? (
				<div className={styles.editorGrid} aria-hidden="true">
					<div className={styles.editorPane}>
						{ROWS.map((item) => (
							<div className={styles.editorRow} key={item}>
								<SkeletonBlock className={styles.rowMeta} />
								<SkeletonBlock className={styles.rowMain} />
								<SkeletonBlock className={styles.rowAction} />
							</div>
						))}
					</div>
					<aside className={styles.editorInspector}>
						<SkeletonBlock className={styles.inspectorTitle} />
						<SkeletonBlock className={styles.inspectorField} />
						<SkeletonBlock className={styles.inspectorFieldTall} />
						<SkeletonBlock className={styles.inspectorField} />
					</aside>
				</div>
			) : variant === "processing" ? (
				<div className={styles.processingGrid} aria-hidden="true">
					<div className={styles.metricStrip}>
						{METRICS.map((item) => (
							<div className={styles.metric} key={item}>
								<SkeletonBlock className={styles.metricValue} />
								<SkeletonBlock className={styles.metricLabel} />
							</div>
						))}
					</div>
					<div className={styles.processingMain}>
						<SkeletonBlock className={styles.processingHeadline} />
						<SkeletonBlock className={styles.progressTrack} />
						<SkeletonBlock className={styles.processingCopy} />
						<div className={styles.stageRow}>
							{STAGES.map((item) => (
								<SkeletonBlock className={styles.stage} key={item} />
							))}
						</div>
					</div>
				</div>
			) : (
				<div className={styles.table} aria-hidden="true">
					{ROWS.map((item) => (
						<div className={styles.tableRow} key={item}>
							<SkeletonBlock className={styles.rowPrimary} />
							<SkeletonBlock className={styles.rowSecondary} />
							<SkeletonBlock className={styles.rowSecondaryShort} />
							<SkeletonBlock className={styles.rowButton} />
						</div>
					))}
				</div>
			)}
		</LoadingShell>
	);
}

export function WorldRouteLoading({
	label = "Carregando Mundo",
}: Readonly<{ label?: string }>) {
	return (
		<LoadingShell family="world" kind="world-canvas" label={label}>
			<div className={styles.worldHeader} aria-hidden="true">
				<div>
					<SkeletonBlock className={styles.worldEyebrow} />
					<SkeletonBlock className={styles.worldTitle} />
				</div>
				<div className={styles.worldActions}>
					<SkeletonBlock className={styles.worldSearch} />
					<SkeletonBlock className={styles.worldAction} />
				</div>
			</div>
			<div className={styles.worldCanvas} aria-hidden="true">
				{NODES.map((item) => (
					<SkeletonBlock
						className={cx(styles.worldNode, styles[item])}
						key={item}
					/>
				))}
			</div>
		</LoadingShell>
	);
}

export function CompactRouteLoading({
	label = "Carregando",
}: Readonly<{ label?: string }>) {
	return (
		<LoadingShell family="compact" kind="compact" label={label}>
			<div className={styles.compactPanel} aria-hidden="true">
				<SkeletonBlock className={styles.eyebrow} />
				<SkeletonBlock className={styles.compactTitle} />
				<SkeletonBlock className={styles.compactText} />
				<SkeletonBlock className={styles.compactTextShort} />
				<div className={styles.compactActions}>
					<SkeletonBlock className={styles.compactButton} />
					<SkeletonBlock className={styles.compactButtonSecondary} />
				</div>
			</div>
		</LoadingShell>
	);
}
