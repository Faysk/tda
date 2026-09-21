"use client";

import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type FormEvent,
	type ReactNode,
} from "react";
import { Button } from "@/components/ui";
import {
	hasLembraDateFilter,
	isWithinLembraDateRange,
	matchesLembraSearch,
	type LembraDateRange,
} from "../search";
import styles from "./lembra.module.css";

type ViewFilter = "all" | "mine" | "favorites";

type ReferenceItem = Readonly<{
	id: string;
	title: string;
	description: string;
	author: string;
	createdAt: string;
	imageUrl: string;
	mine: boolean;
}>;

type ReferenceDraft = Readonly<{
	file: File;
	previewUrl: string;
	title: string;
	description: string;
}>;

const EMPTY_DATE_RANGE: LembraDateRange = { from: "", to: "" };

const DATE_FORMATTER = new Intl.DateTimeFormat("pt-BR", {
	day: "2-digit",
	month: "short",
	year: "numeric",
});

function SearchIcon() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<circle cx="11" cy="11" r="6.5" />
			<path d="m16 16 4 4" />
		</svg>
	);
}

function ImageIcon() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
			<circle cx="9" cy="9.5" r="1.5" />
			<path d="m5.5 17 4.5-4 3.25 3 2.5-2 2.75 3" />
		</svg>
	);
}

function UserIcon() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<circle cx="12" cy="8" r="3.5" />
			<path d="M5.5 20c.6-4 2.75-6 6.5-6s5.9 2 6.5 6" />
		</svg>
	);
}

function HeartIcon({ filled = false }: { filled?: boolean }) {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				className={filled ? styles.iconFill : undefined}
				d="M20.4 5.8c-1.9-2-5.1-2-7 0L12 7.2l-1.4-1.4c-1.9-2-5.1-2-7 0-2.1 2.2-2.1 5.7 0 7.9L12 22l8.4-8.3c2.1-2.2 2.1-5.7 0-7.9Z"
			/>
		</svg>
	);
}

function PlusIcon() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path d="M12 5v14M5 12h14" />
		</svg>
	);
}

function CalendarIcon() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<rect x="3.5" y="5" width="17" height="15" rx="2.5" />
			<path d="M7.5 3.5v3M16.5 3.5v3M3.5 9.5h17" />
		</svg>
	);
}

function isImageFile(file: File | undefined): file is File {
	return Boolean(file?.type.startsWith("image/"));
}

function hasDraggedFiles(event: DragEvent) {
	return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

function createClientId() {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}
	return `lembra-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function dateFilterLabel(range: LembraDateRange) {
	if (!range.from && !range.to) return "Data";
	if (range.from && range.to) return "Período";
	if (range.from) return "Desde";
	return "Até";
}

export function LembraExperience() {
	const [references, setReferences] = useState<ReferenceItem[]>([]);
	const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => new Set());
	const [view, setView] = useState<ViewFilter>("all");
	const [query, setQuery] = useState("");
	const [dateRange, setDateRange] = useState<LembraDateRange>(EMPTY_DATE_RANGE);
	const [draft, setDraft] = useState<ReferenceDraft | null>(null);
	const [dragging, setDragging] = useState(false);
	const [message, setMessage] = useState("");

	const searchRef = useRef<HTMLInputElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const dialogRef = useRef<HTMLDialogElement>(null);
	const titleRef = useRef<HTMLInputElement>(null);
	const dragDepthRef = useRef(0);
	const ownedUrlsRef = useRef(new Set<string>());

	const discardUrl = useCallback((url: string) => {
		if (!ownedUrlsRef.current.has(url)) return;
		URL.revokeObjectURL(url);
		ownedUrlsRef.current.delete(url);
	}, []);

	const closeDraft = useCallback(() => {
		setDraft((current) => {
			if (current) discardUrl(current.previewUrl);
			return null;
		});
	}, [discardUrl]);

	const prepareFile = useCallback((file: File | undefined) => {
		if (!isImageFile(file)) {
			setMessage("Escolha uma imagem para guardar no Lembra.");
			return;
		}

		const previewUrl = URL.createObjectURL(file);
		ownedUrlsRef.current.add(previewUrl);
		setMessage("");
		setDraft((current) => {
			if (current) {
				URL.revokeObjectURL(current.previewUrl);
				ownedUrlsRef.current.delete(current.previewUrl);
			}
			return {
				file,
				previewUrl,
				title: file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim(),
				description: "",
			};
		});
	}, []);

	useEffect(() => {
		return () => {
			for (const url of ownedUrlsRef.current) URL.revokeObjectURL(url);
			ownedUrlsRef.current.clear();
		};
	}, []);

	useEffect(() => {
		if (!message) return;
		const timeout = window.setTimeout(() => setMessage(""), 4000);
		return () => window.clearTimeout(timeout);
	}, [message]);

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;

		if (draft && !dialog.open) {
			dialog.showModal();
			requestAnimationFrame(() => titleRef.current?.focus());
		} else if (!draft && dialog.open) {
			dialog.close();
		}
	}, [draft]);

	useEffect(() => {
		const onShortcut = (event: KeyboardEvent) => {
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				searchRef.current?.focus();
			}
		};

		const onPaste = (event: ClipboardEvent) => {
			const item = Array.from(event.clipboardData?.items ?? []).find((entry) =>
				entry.type.startsWith("image/"),
			);
			const file = item?.getAsFile() ?? undefined;
			if (!file) return;
			event.preventDefault();
			prepareFile(file);
		};

		const onDragEnter = (event: DragEvent) => {
			if (!hasDraggedFiles(event)) return;
			event.preventDefault();
			dragDepthRef.current += 1;
			setDragging(true);
		};

		const onDragOver = (event: DragEvent) => {
			if (!hasDraggedFiles(event)) return;
			event.preventDefault();
			if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
		};

		const onDragLeave = (event: DragEvent) => {
			if (!hasDraggedFiles(event)) return;
			event.preventDefault();
			dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
			if (dragDepthRef.current === 0) setDragging(false);
		};

		const onDrop = (event: DragEvent) => {
			if (!hasDraggedFiles(event)) return;
			event.preventDefault();
			dragDepthRef.current = 0;
			setDragging(false);
			const file = Array.from(event.dataTransfer?.files ?? []).find(isImageFile);
			prepareFile(file);
		};

		window.addEventListener("keydown", onShortcut);
		window.addEventListener("paste", onPaste);
		window.addEventListener("dragenter", onDragEnter);
		window.addEventListener("dragover", onDragOver);
		window.addEventListener("dragleave", onDragLeave);
		window.addEventListener("drop", onDrop);
		return () => {
			window.removeEventListener("keydown", onShortcut);
			window.removeEventListener("paste", onPaste);
			window.removeEventListener("dragenter", onDragEnter);
			window.removeEventListener("dragover", onDragOver);
			window.removeEventListener("dragleave", onDragLeave);
			window.removeEventListener("drop", onDrop);
		};
	}, [prepareFile]);

	const visibleReferences = useMemo(() => {
		return references.filter((item) => {
			if (view === "mine" && !item.mine) return false;
			if (view === "favorites" && !favoriteIds.has(item.id)) return false;
			if (!matchesLembraSearch(item, query)) return false;
			return isWithinLembraDateRange(item.createdAt, dateRange);
		});
	}, [dateRange, favoriteIds, query, references, view]);

	const filtersActive = Boolean(query.trim()) || hasLembraDateFilter(dateRange);

	function openFilePicker() {
		fileInputRef.current?.click();
	}

	function saveReference(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!draft) return;

		const title = draft.title.trim();
		if (!title) {
			titleRef.current?.focus();
			return;
		}

		const item: ReferenceItem = {
			id: createClientId(),
			title,
			description: draft.description.trim(),
			author: "Você",
			createdAt: new Date().toISOString(),
			imageUrl: draft.previewUrl,
			mine: true,
		};

		setReferences((current) => [item, ...current]);
		setDraft(null);
		setView("all");
		setMessage("Referência adicionada nesta sessão.");
	}

	function toggleFavorite(id: string) {
		setFavoriteIds((current) => {
			const next = new Set(current);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	function clearSearchFilters() {
		setQuery("");
		setDateRange(EMPTY_DATE_RANGE);
		searchRef.current?.focus();
	}

	const navItems: ReadonlyArray<{
		id: ViewFilter;
		label: string;
		icon: ReactNode;
		count: number;
	}> = [
		{ id: "all", label: "Lembra", icon: <ImageIcon />, count: references.length },
		{
			id: "mine",
			label: "Meus itens",
			icon: <UserIcon />,
			count: references.filter((item) => item.mine).length,
		},
		{
			id: "favorites",
			label: "Favoritos",
			icon: <HeartIcon />,
			count: favoriteIds.size,
		},
	];

	return (
		<div className={styles.shell}>
			<aside className={styles.sidebar} aria-label="Filtros do Lembra">
				<nav className={styles.sidebarNav}>
					{navItems.map((item) => (
						<button
							key={item.id}
							type="button"
							className={view === item.id ? styles.navItemActive : styles.navItem}
							onClick={() => setView(item.id)}
							aria-pressed={view === item.id}
						>
							<span className={styles.navIcon}>{item.icon}</span>
							<span>{item.label}</span>
							<span className={styles.navCount}>{item.count}</span>
						</button>
					))}
				</nav>
				<p className={styles.sidebarNote}>
					Boas ideias vivem mais quando a gente consegue encontrá-las de novo.
				</p>
			</aside>

			<section className={styles.content} aria-labelledby="lembra-title">
				<h1 className={styles.visuallyHidden} id="lembra-title">
					Lembra
				</h1>

				<nav className={styles.compactNav} aria-label="Filtros do Lembra">
					{navItems.map((item) => (
						<button
							key={item.id}
							type="button"
							className={view === item.id ? styles.filterActive : styles.filter}
							onClick={() => setView(item.id)}
							aria-pressed={view === item.id}
						>
							{item.label}
							<span>{item.count}</span>
						</button>
					))}
				</nav>

				<div className={styles.toolbar}>
					<label className={styles.searchBox}>
						<span className={styles.searchIcon}>
							<SearchIcon />
						</span>
						<span className={styles.visuallyHidden}>
							Buscar por título, descrição, autor ou data
						</span>
						<input
							ref={searchRef}
							type="search"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Buscar por título, descrição, autor ou data..."
						/>
						<kbd>Ctrl K</kbd>
					</label>

					<details className={styles.dateFilter}>
						<summary className={hasLembraDateFilter(dateRange) ? styles.dateSummaryActive : styles.dateSummary}>
							<span className={styles.dateIcon}>
								<CalendarIcon />
							</span>
							{dateFilterLabel(dateRange)}
						</summary>
						<div className={styles.datePanel}>
							<label>
								<span>De</span>
								<input
									type="date"
									value={dateRange.from}
									max={dateRange.to || undefined}
									onChange={(event) =>
										setDateRange((current) => ({
											...current,
											from: event.target.value,
										}))
									}
								/>
							</label>
							<label>
								<span>Até</span>
								<input
									type="date"
									value={dateRange.to}
									min={dateRange.from || undefined}
									onChange={(event) =>
										setDateRange((current) => ({
											...current,
											to: event.target.value,
										}))
									}
								/>
							</label>
							<button
								type="button"
								className={styles.clearDate}
								onClick={() => setDateRange(EMPTY_DATE_RANGE)}
								disabled={!hasLembraDateFilter(dateRange)}
							>
								Limpar data
							</button>
						</div>
					</details>

					<Button variant="primary" className={styles.addButton} onClick={openFilePicker}>
						<span className={styles.buttonIcon}>
							<PlusIcon />
						</span>
						Adicionar imagem
					</Button>
				</div>

				{message ? (
					<div className={styles.toast} role="status" aria-live="polite">
						{message}
					</div>
				) : null}

				{visibleReferences.length ? (
					<div className={styles.grid}>
						{visibleReferences.map((item) => {
							const favorite = favoriteIds.has(item.id);
							return (
								<article className={styles.card} key={item.id}>
									<div className={styles.media}>
										<img
											src={item.imageUrl}
											alt={`Referência visual: ${item.title}`}
											loading="lazy"
											decoding="async"
										/>
										<button
											type="button"
											className={favorite ? styles.favoriteActive : styles.favorite}
											onClick={() => toggleFavorite(item.id)}
											aria-pressed={favorite}
											aria-label={
												favorite
													? `Remover ${item.title} dos favoritos`
													: `Adicionar ${item.title} aos favoritos`
											}
										>
											<HeartIcon filled={favorite} />
										</button>
									</div>
									<div className={styles.cardBody}>
										<h2>{item.title}</h2>
										{item.description ? <p>{item.description}</p> : null}
										<div className={styles.cardMeta}>
											<span>Por {item.author}</span>
											<time dateTime={item.createdAt}>
												{DATE_FORMATTER.format(new Date(item.createdAt))}
											</time>
										</div>
									</div>
								</article>
							);
						})}
					</div>
				) : (
					<div className={styles.emptyState}>
						<span className={styles.emptyIcon} aria-hidden="true">
							<ImageIcon />
						</span>
						<h2>{filtersActive ? "Não lembramos dessa." : "Ainda não guardamos nada aqui."}</h2>
						<p>
							{filtersActive
								? "Tente outra combinação de palavras ou ajuste o período."
								: "Arraste uma imagem para esta tela, cole com Ctrl+V ou escolha um arquivo do computador."}
						</p>
						{filtersActive ? (
							<Button variant="secondary" onClick={clearSearchFilters}>
								Limpar filtros
							</Button>
						) : (
							<Button variant="secondary" onClick={openFilePicker}>
								Escolher arquivo
							</Button>
						)}
					</div>
				)}

				<input
					ref={fileInputRef}
					className={styles.visuallyHidden}
					type="file"
					accept="image/*"
					onChange={(event) => {
						prepareFile(event.target.files?.[0]);
						event.target.value = "";
					}}
				/>
			</section>

			{dragging ? (
				<div className={styles.dropOverlay} role="status" aria-live="polite">
					<div className={styles.dropOverlayInner}>
						<span className={styles.dropIcon}>
							<ImageIcon />
						</span>
						<strong>Solte para guardar no Lembra</strong>
						<span>A imagem abre direto no composer.</span>
					</div>
				</div>
			) : null}

			<dialog
				ref={dialogRef}
				className={styles.dialog}
				onCancel={(event) => {
					event.preventDefault();
					closeDraft();
				}}
			>
				{draft ? (
					<form className={styles.composer} onSubmit={saveReference}>
						<div className={styles.composerMedia}>
							<img src={draft.previewUrl} alt="Preview da referência selecionada" />
						</div>
						<div className={styles.composerBody}>
							<div className={styles.composerHeading}>
								<div>
									<p>Guardar no Lembra</p>
									<h2>Quase lá.</h2>
								</div>
								<button
									type="button"
									className={styles.closeButton}
									onClick={closeDraft}
									aria-label="Fechar"
								>
									<span aria-hidden="true">×</span>
								</button>
							</div>

							<label className={styles.field}>
								<span>Nome</span>
								<input
									ref={titleRef}
									type="text"
									required
									maxLength={120}
									value={draft.title}
									onChange={(event) =>
										setDraft((current) =>
											current ? { ...current, title: event.target.value } : current,
										)
									}
									placeholder="Ex.: Ruínas élficas"
								/>
							</label>

							<label className={styles.field}>
								<span>Descrição</span>
								<textarea
									rows={4}
									maxLength={320}
									value={draft.description}
									onChange={(event) =>
										setDraft((current) =>
											current
												? { ...current, description: event.target.value }
												: current,
										)
									}
									placeholder="O que você quer lembrar sobre essa imagem?"
								/>
							</label>

							<div className={styles.autoMeta}>
								<span>Publicado por você</span>
								<span>Data automática</span>
							</div>

							<div className={styles.composerActions}>
								<Button
									type="button"
									variant="tertiary"
									className={styles.composerAction}
									onClick={closeDraft}
								>
									Cancelar
								</Button>
								<Button type="submit" variant="primary" className={styles.composerAction}>
									Guardar
								</Button>
							</div>
						</div>
					</form>
				) : null}
			</dialog>
		</div>
	);
}
