"use client";

import {
	useCallback,
	useDeferredValue,
	useEffect,
	useMemo,
	useRef,
	useState,
	type FormEvent,
	type ReactNode,
} from "react";
import { Button, Select, type SelectOption } from "@/components/ui";
import {
	finalizeLembraUploadAction,
	retireLembraReferenceAction,
	setLembraFavoriteAction,
	updateLembraReferenceAction,
	requestLembraUploadAction,
} from "../actions";
import {
	LEMBRA_MAX_BYTES,
	isLembraMediaMime,
	type LembraMediaMime,
	type LembraReference,
	type LembraUploadIntent,
} from "../model";
import {
	hasLembraDateFilter,
	isWithinLembraDateRange,
	matchesLembraSearch,
	type LembraDateRange,
} from "../search";
import {
	sortLembraReferences,
	type LembraSort,
} from "../sort";
import styles from "./lembra.module.css";

type ViewFilter = "all" | "mine" | "favorites";

type LembraExperienceProps = Readonly<{
	initialReferences?: readonly LembraReference[];
	initialFavoriteIds?: readonly string[];
	persistenceEnabled?: boolean;
}>;

type ReferenceDraft = Readonly<{
	file: File;
	previewUrl: string;
	title: string;
	description: string;
}>;

type SavePhase =
	| "idle"
	| "preparing"
	| "uploading"
	| "finalizing"
	| "success"
	| "error";

type UploadStatus = Readonly<{
	phase: SavePhase;
	uploadedBytes: number;
	totalBytes: number;
}>;

const EMPTY_UPLOAD_STATUS: UploadStatus = {
	phase: "idle",
	uploadedBytes: 0,
	totalBytes: 0,
};

const EMPTY_DATE_RANGE: LembraDateRange = { from: "", to: "" };

const SORT_OPTIONS: readonly SelectOption<LembraSort>[] = [
	{ value: "newest", label: "Mais recentes" },
	{ value: "oldest", label: "Mais antigas" },
	{ value: "title", label: "Nome" },
	{ value: "author", label: "Autor" },
];

const DATE_FORMATTER = new Intl.DateTimeFormat("pt-BR", {
	day: "2-digit",
	month: "short",
	year: "numeric",
});

const LONG_DATE_FORMATTER = new Intl.DateTimeFormat("pt-BR", {
	day: "2-digit",
	month: "long",
	year: "numeric",
});

const INPUT_DATE_FORMATTER = new Intl.DateTimeFormat("pt-BR", {
	day: "2-digit",
	month: "2-digit",
	timeZone: "UTC",
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

function SortIcon() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path d="M8 6h12M8 12h9M8 18h6" />
			<path d="M4 4v16M2 18l2 2 2-2" />
		</svg>
	);
}

function ArrowIcon({ direction }: { direction: "left" | "right" }) {
	return (
		<svg
			viewBox="0 0 24 24"
			aria-hidden="true"
			className={direction === "right" ? styles.arrowRight : undefined}
		>
			<path d="m15 5-7 7 7 7" />
		</svg>
	);
}

function isImageFile(file: File | undefined): file is File {
	return Boolean(
		file &&
			isLembraMediaMime(file.type) &&
			file.size >= 24 &&
			file.size <= LEMBRA_MAX_BYTES,
	);
}

function hasDraggedFiles(event: DragEvent) {
	return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

function suggestedTitle(file: File) {
	const title = file.name
		.replace(/\.[^.]+$/u, "")
		.replace(/[-_]+/gu, " ")
		.trim();
	if (/^(image|blob|clipboard|pasted image)$/iu.test(title)) return "";
	return title;
}

function createClientId() {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}
	return `lembra-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function bytesToHex(bytes: Uint8Array) {
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function uploadIntent(file: File): Promise<LembraUploadIntent> {
	if (!isImageFile(file)) throw new Error("invalid_file");
	const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
	return {
		sha256: bytesToHex(new Uint8Array(digest)),
		mimeType: file.type as LembraMediaMime,
		bytes: file.size,
	};
}

function uploadChunk(
	url: string,
	body: Blob,
	onProgress: (uploadedBytes: number) => void,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const request = new XMLHttpRequest();
		request.open("PUT", url);
		request.setRequestHeader("Content-Type", "application/octet-stream");
		request.upload.addEventListener("progress", (event) => {
			if (!event.lengthComputable) return;
			onProgress(event.loaded);
		});
		request.addEventListener("load", () => {
			if (request.status >= 200 && request.status < 300) {
				onProgress(body.size);
				resolve();
				return;
			}
			reject(new Error(`upload_http_${request.status}`));
		});
		request.addEventListener("error", () => reject(new Error("upload_network_error")));
		request.addEventListener("abort", () => reject(new Error("upload_aborted")));
		request.send(body);
	});
}

function formatUploadBytes(bytes: number) {
	const megabytes = bytes / (1024 * 1024);
	if (megabytes >= 1) {
		return `${megabytes.toFixed(megabytes >= 10 ? 0 : 1)} MB`;
	}
	const kilobytes = Math.max(0, Math.round(bytes / 1024));
	return `${kilobytes} KB`;
}

function mutationMessage(reason: string) {
	switch (reason) {
		case "unauthenticated":
			return "Entre novamente para continuar usando o Lembra.";
		case "media_unavailable":
			return "O armazenamento do Lembra ainda não está disponível.";
		case "invalid_payload":
			return "Essa imagem ou referência não é válida.";
		case "not_found":
			return "Essa referência não existe mais.";
		case "conflict":
			return "Essa alteração entrou em conflito. Tente novamente.";
		default:
			return "Não foi possível concluir essa ação agora.";
	}
}

function compactInputDate(value: string) {
	if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return "";
	const date = new Date(`${value}T00:00:00.000Z`);
	return Number.isNaN(date.getTime()) ? "" : INPUT_DATE_FORMATTER.format(date);
}

function dateFilterLabel(range: LembraDateRange) {
	if (!range.from && !range.to) return "Data";

	const from = compactInputDate(range.from);
	const to = compactInputDate(range.to);
	if (from && to) return from === to ? from : `${from}–${to}`;
	if (from) return `Desde ${from}`;
	if (to) return `Até ${to}`;
	return "Data";
}

export function LembraExperience({
	initialReferences = [],
	initialFavoriteIds = [],
	persistenceEnabled = false,
}: LembraExperienceProps) {
	const [references, setReferences] = useState<LembraReference[]>(() => [
		...initialReferences,
	]);
	const [favoriteIds, setFavoriteIds] = useState<Set<string>>(
		() => new Set(initialFavoriteIds),
	);
	const [view, setView] = useState<ViewFilter>("all");
	const [query, setQuery] = useState("");
	const deferredQuery = useDeferredValue(query);
	const [dateRange, setDateRange] = useState<LembraDateRange>(EMPTY_DATE_RANGE);
	const [sort, setSort] = useState<LembraSort>("newest");
	const [draft, setDraft] = useState<ReferenceDraft | null>(null);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [dragging, setDragging] = useState(false);
	const [message, setMessage] = useState("");
	const [saving, setSaving] = useState(false);
	const [uploadStatus, setUploadStatus] =
		useState<UploadStatus>(EMPTY_UPLOAD_STATUS);
	const [editing, setEditing] = useState(false);
	const [confirmRemove, setConfirmRemove] = useState(false);
	const [brokenImageIds, setBrokenImageIds] = useState<Set<string>>(
		() => new Set(),
	);
	const [editTitle, setEditTitle] = useState("");
	const [editDescription, setEditDescription] = useState("");

	const searchRef = useRef<HTMLInputElement>(null);
	const dateFilterRef = useRef<HTMLDetailsElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const dialogRef = useRef<HTMLDialogElement>(null);
	const viewerRef = useRef<HTMLDialogElement>(null);
	const titleRef = useRef<HTMLInputElement>(null);
	const dragDepthRef = useRef(0);
	const ownedUrlsRef = useRef(new Set<string>());

	const discardUrl = useCallback((url: string) => {
		if (!ownedUrlsRef.current.has(url)) return;
		URL.revokeObjectURL(url);
		ownedUrlsRef.current.delete(url);
	}, []);

	const closeDraft = useCallback(() => {
		setUploadStatus(EMPTY_UPLOAD_STATUS);
		setMessage("");
		setDraft((current) => {
			if (current) discardUrl(current.previewUrl);
			return null;
		});
	}, [discardUrl]);

	const prepareFile = useCallback((file: File | undefined) => {
		if (!isImageFile(file)) {
			setMessage("Use uma imagem JPG, PNG ou WebP de até 12 MB.");
			return;
		}

		const previewUrl = URL.createObjectURL(file);
		ownedUrlsRef.current.add(previewUrl);
		setMessage("");
		setUploadStatus(EMPTY_UPLOAD_STATUS);
		setDraft((current) => {
			if (current) {
				URL.revokeObjectURL(current.previewUrl);
				ownedUrlsRef.current.delete(current.previewUrl);
			}
			return {
				file,
				previewUrl,
				title: suggestedTitle(file),
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
		const dateFilter = dateFilterRef.current;
		if (!dateFilter) return;

		const closeDateFilter = () => dateFilter.removeAttribute("open");

		const onPointerDown = (event: PointerEvent) => {
			if (!dateFilter.open || dateFilter.contains(event.target as Node)) return;
			closeDateFilter();
		};

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || !dateFilter.open) return;
			event.preventDefault();
			closeDateFilter();
			dateFilter.querySelector("summary")?.focus();
		};

		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
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
		const viewer = viewerRef.current;
		if (!viewer) return;

		if (selectedId && !viewer.open) {
			viewer.showModal();
		} else if (!selectedId && viewer.open) {
			viewer.close();
		}
	}, [selectedId]);

	useEffect(() => {
		const onShortcut = (event: KeyboardEvent) => {
			if (
				(event.ctrlKey || event.metaKey) &&
				(event.key.toLowerCase() === "k" || event.code === "KeyK")
			) {
				event.preventDefault();
				event.stopPropagation();
				searchRef.current?.focus({ preventScroll: true });
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
		const filtered = references.filter((item) => {
			if (view === "mine" && !item.mine) return false;
			if (view === "favorites" && !favoriteIds.has(item.id)) return false;
			if (!matchesLembraSearch(item, deferredQuery)) return false;
			return isWithinLembraDateRange(item.createdAt, dateRange);
		});
		return sortLembraReferences(filtered, sort);
	}, [dateRange, deferredQuery, favoriteIds, references, sort, view]);

	const selectedIndex = selectedId
		? visibleReferences.findIndex((item) => item.id === selectedId)
		: -1;
	const selectedReference =
		selectedIndex >= 0 ? visibleReferences[selectedIndex] : null;

	const textOrDateFilterActive =
		Boolean(query.trim()) || hasLembraDateFilter(dateRange);
	const filtersActive = view !== "all" || textOrDateFilterActive;

	const emptyCopy = (() => {
		if (references.length === 0) {
			return {
				title: "Ainda não guardamos nada aqui.",
				description:
					"Arraste uma imagem para esta tela, cole com Ctrl+V ou escolha um arquivo do computador.",
			};
		}
		if (textOrDateFilterActive) {
			return {
				title: "Nada por aqui com esses filtros.",
				description:
					"Tente outra combinação de palavras ou ajuste o período.",
			};
		}
		if (view === "favorites") {
			return {
				title: "Nenhum favorito ainda.",
				description:
					"Marque o coração nas referências que você quer encontrar em um segundo durante a call.",
			};
		}
		if (view === "mine") {
			return {
				title: "Você ainda não guardou referências.",
				description:
					"Volte ao Lembra para ver tudo ou adicione uma imagem nova.",
			};
		}
		return {
			title: "Nada por aqui.",
			description: "Ajuste os filtros para voltar à galeria.",
		};
	})();

	const closeViewer = useCallback(() => {
		setEditing(false);
		setConfirmRemove(false);
		setEditTitle("");
		setEditDescription("");
		setSelectedId(null);
	}, []);

	const openViewer = useCallback((id: string) => {
		setEditing(false);
		setConfirmRemove(false);
		setEditTitle("");
		setEditDescription("");
		setBrokenImageIds((current) => {
			if (!current.has(id)) return current;
			const next = new Set(current);
			next.delete(id);
			return next;
		});
		setSelectedId(id);
	}, []);

	const moveViewer = useCallback(
		(delta: number) => {
			if (!selectedId || visibleReferences.length < 2) return;
			const index = visibleReferences.findIndex((item) => item.id === selectedId);
			if (index < 0) return;
			const nextIndex =
				(index + delta + visibleReferences.length) % visibleReferences.length;
			setEditing(false);
			setConfirmRemove(false);
			setEditTitle("");
			setEditDescription("");
			setSelectedId(visibleReferences[nextIndex].id);
		},
		[selectedId, visibleReferences],
	);

	useEffect(() => {
		if (!selectedId) return;
		if (!selectedReference) {
			closeViewer();
			return;
		}

		const onKeyDown = (event: KeyboardEvent) => {
			if (editing) return;
			if (event.key === "ArrowLeft") {
				event.preventDefault();
				moveViewer(-1);
			}
			if (event.key === "ArrowRight") {
				event.preventDefault();
				moveViewer(1);
			}
		};

		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [closeViewer, editing, moveViewer, selectedId, selectedReference]);

	function openFilePicker() {
		fileInputRef.current?.click();
	}

	async function saveReference(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!draft || saving) return;

		const title = draft.title.trim();
		const description = draft.description.trim();
		if (!title) {
			titleRef.current?.focus();
			return;
		}

		if (!persistenceEnabled) {
			const now = new Date().toISOString();
			const item: LembraReference = {
				id: createClientId(),
				title,
				description,
				author: "Você",
				authorAuthUserId: "local",
				createdAt: now,
				updatedAt: now,
				imageUrl: draft.previewUrl,
				mine: true,
			};
			setReferences((current) => [item, ...current]);
			setDraft(null);
			setView("all");
			setMessage("Referência adicionada nesta sessão.");
			return;
		}

		setSaving(true);
		setMessage("");
		setUploadStatus({
			phase: "preparing",
			uploadedBytes: 0,
			totalBytes: draft.file.size,
		});
		try {
			const intent = await uploadIntent(draft.file);
			const requested = await requestLembraUploadAction(intent);
			if (!requested.ok) {
				setUploadStatus((current) => ({ ...current, phase: "error" }));
				setMessage(mutationMessage(requested.reason));
				return;
			}

			setUploadStatus({
				phase: "uploading",
				uploadedBytes: 0,
				totalBytes: draft.file.size,
			});
			const totalParts = Math.ceil(draft.file.size / requested.chunkBytes);
			for (let part = 0; part < totalParts; part += 1) {
				const start = part * requested.chunkBytes;
				const end = Math.min(start + requested.chunkBytes, draft.file.size);
				const chunk = draft.file.slice(start, end);
				const url = `/api/lembra/upload?referenceId=${encodeURIComponent(
					requested.referenceId,
				)}&uploadId=${encodeURIComponent(
					requested.uploadId,
				)}&part=${part}`;

				try {
					await uploadChunk(url, chunk, (chunkUploadedBytes) => {
						setUploadStatus({
							phase: "uploading",
							uploadedBytes: Math.min(
								draft.file.size,
								start + chunkUploadedBytes,
							),
							totalBytes: draft.file.size,
						});
					});
				} catch {
					setUploadStatus((current) => ({ ...current, phase: "error" }));
					setMessage("O envio da imagem falhou. Tente novamente.");
					return;
				}
				setUploadStatus({
					phase: "uploading",
					uploadedBytes: end,
					totalBytes: draft.file.size,
				});
			}

			setUploadStatus({
				phase: "finalizing",
				uploadedBytes: draft.file.size,
				totalBytes: draft.file.size,
			});
			const finalized = await finalizeLembraUploadAction(
				requested.referenceId,
				requested.uploadId,
				intent,
				title,
				description,
			);
			if (!finalized.ok) {
				setUploadStatus((current) => ({ ...current, phase: "error" }));
				setMessage(mutationMessage(finalized.reason));
				return;
			}

			setUploadStatus({
				phase: "success",
				uploadedBytes: draft.file.size,
				totalBytes: draft.file.size,
			});
			await new Promise((resolve) => window.setTimeout(resolve, 800));

			discardUrl(draft.previewUrl);
			setReferences((current) => [
				finalized.reference,
				...current.filter((item) => item.id !== finalized.reference.id),
			]);
			setUploadStatus(EMPTY_UPLOAD_STATUS);
			setDraft(null);
			setView("all");
			setMessage("Referência publicada.");
		} catch {
			setUploadStatus((current) => ({ ...current, phase: "error" }));
			setMessage("Não foi possível guardar a referência agora.");
		} finally {
			setSaving(false);
		}
	}

	async function toggleFavorite(id: string) {
		const wasFavorite = favoriteIds.has(id);
		const favorite = !wasFavorite;
		setFavoriteIds((current) => {
			const next = new Set(current);
			if (favorite) next.add(id);
			else next.delete(id);
			return next;
		});

		if (!persistenceEnabled) return;

		try {
			const result = await setLembraFavoriteAction(id, favorite);
			if (result.ok) return;
			setFavoriteIds((current) => {
				const next = new Set(current);
				if (wasFavorite) next.add(id);
				else next.delete(id);
				return next;
			});
			setMessage(mutationMessage(result.reason));
		} catch {
			setFavoriteIds((current) => {
				const next = new Set(current);
				if (wasFavorite) next.add(id);
				else next.delete(id);
				return next;
			});
			setMessage("Não foi possível atualizar o favorito agora.");
		}
	}

	function startEditing(reference: LembraReference) {
		setConfirmRemove(false);
		setEditTitle(reference.title);
		setEditDescription(reference.description);
		setEditing(true);
	}

	function cancelEditing() {
		setEditing(false);
		setEditTitle("");
		setEditDescription("");
	}

	async function saveReferenceEdit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!selectedReference || saving) return;
		const title = editTitle.trim();
		const description = editDescription.trim();
		if (!title) return;

		if (!persistenceEnabled) {
			const updatedAt = new Date().toISOString();
			setReferences((current) =>
				current.map((item) =>
					item.id === selectedReference.id
						? { ...item, title, description, updatedAt }
						: item,
				),
			);
			setEditing(false);
			setMessage("Referência atualizada nesta sessão.");
			return;
		}

		setSaving(true);
		try {
			const result = await updateLembraReferenceAction(
				selectedReference.id,
				title,
				description,
			);
			if (!result.ok) {
				setMessage(mutationMessage(result.reason));
				return;
			}
			setReferences((current) =>
				current.map((item) =>
					item.id === result.reference.id ? result.reference : item,
				),
			);
			setEditing(false);
			setMessage("Referência atualizada.");
		} catch {
			setMessage("Não foi possível salvar a alteração agora.");
		} finally {
			setSaving(false);
		}
	}

	async function removeSelectedReference() {
		if (!selectedReference || saving) return;

		setSaving(true);
		try {
			if (persistenceEnabled) {
				const result = await retireLembraReferenceAction(selectedReference.id);
				if (!result.ok) {
					setMessage(mutationMessage(result.reason));
					return;
				}
			}

			discardUrl(selectedReference.imageUrl);
			setReferences((current) =>
				current.filter((item) => item.id !== selectedReference.id),
			);
			setFavoriteIds((current) => {
				const next = new Set(current);
				next.delete(selectedReference.id);
				return next;
			});
			closeViewer();
			setMessage("Referência removida.");
		} catch {
			setMessage("Não foi possível remover a referência agora.");
		} finally {
			setSaving(false);
		}
	}

	function clearSearchFilters() {
		setQuery("");
		setDateRange(EMPTY_DATE_RANGE);
		setView("all");
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
							placeholder="Buscar título, descrição, autor ou data..."
						/>
						<kbd>Ctrl K</kbd>
					</label>

					<details ref={dateFilterRef} className={styles.dateFilter}>
						<summary
							className={
								hasLembraDateFilter(dateRange)
									? styles.dateSummaryActive
									: styles.dateSummary
							}
						>
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
								onClick={() => {
									setDateRange(EMPTY_DATE_RANGE);
									dateFilterRef.current?.removeAttribute("open");
								}}
								disabled={!hasLembraDateFilter(dateRange)}
							>
								Limpar data
							</button>
						</div>
					</details>

					<div className={styles.sortControl}>
						<span className={styles.sortIcon} aria-hidden="true">
							<SortIcon />
						</span>
						<Select
							value={sort}
							options={SORT_OPTIONS}
							onChange={setSort}
							ariaLabel="Ordenar referências"
							className={styles.sortSelect}
							embedded
						/>
					</div>

					<Button
						variant="primary"
						className={styles.addButton}
						onClick={openFilePicker}
						aria-label="Adicionar imagem"
					>
						<span className={styles.buttonIcon}>
							<PlusIcon />
						</span>
						<span className={styles.addButtonLabel}>Adicionar imagem</span>
					</Button>
				</div>

				{filtersActive ? (
					<div className={styles.resultsBar} role="status">
						<span>
							{visibleReferences.length} de {references.length}{" "}
							{references.length === 1 ? "referência" : "referências"}
						</span>
						<button type="button" onClick={clearSearchFilters}>
							Limpar filtros
						</button>
					</div>
				) : null}

				{message && !draft ? (
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
									<div
										className={styles.media}
										style={
											item.width && item.height
												? { aspectRatio: `${item.width} / ${item.height}` }
												: undefined
										}
									>
										{brokenImageIds.has(item.id) ? (
											<div className={styles.mediaFallback} aria-hidden="true">
												<ImageIcon />
												<span>Imagem indisponível</span>
											</div>
										) : (
											<img
												src={item.imageUrl}
												alt=""
												width={item.width}
												height={item.height}
												loading="lazy"
												decoding="async"
												onError={() =>
													setBrokenImageIds((current) => {
														const next = new Set(current);
														next.add(item.id);
														return next;
													})
												}
											/>
										)}
										<button
											type="button"
											className={styles.mediaOpen}
											onClick={() => openViewer(item.id)}
											aria-label={`Abrir referência ${item.title}`}
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
										<h2>
											<button
												type="button"
												className={styles.cardTitleButton}
												onClick={() => openViewer(item.id)}
											>
												{item.title}
											</button>
										</h2>
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
						<h2>{emptyCopy.title}</h2>
						<p>{emptyCopy.description}</p>
						{references.length === 0 ? (
							<Button variant="secondary" onClick={openFilePicker}>
								Escolher arquivo
							</Button>
						) : filtersActive ? (
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
					accept="image/jpeg,image/png,image/webp"
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
				ref={viewerRef}
				className={styles.viewerDialog}
				onCancel={(event) => {
					event.preventDefault();
					if (editing) {
						cancelEditing();
						return;
					}
					if (!saving) closeViewer();
				}}
				aria-labelledby={selectedReference ? `viewer-title-${selectedReference.id}` : undefined}
			>
				{selectedReference ? (
					<div className={styles.viewer} aria-busy={saving}>
						<div className={styles.viewerMedia}>
							<button
								type="button"
								className={styles.viewerMobileClose}
								onClick={closeViewer}
								aria-label="Fechar referência"
								disabled={saving}
							>
								<span aria-hidden="true">×</span>
							</button>
							{brokenImageIds.has(selectedReference.id) ? (
								<div className={styles.viewerMediaFallback}>
									<ImageIcon />
									<strong>Imagem indisponível</strong>
									<span>Tente abrir novamente em instantes.</span>
								</div>
							) : (
								<img
									src={selectedReference.imageUrl}
									alt={`Referência visual: ${selectedReference.title}`}
									width={selectedReference.width}
									height={selectedReference.height}
									onError={() =>
										setBrokenImageIds((current) => {
											const next = new Set(current);
											next.add(selectedReference.id);
											return next;
										})
									}
								/>
							)}
							{visibleReferences.length > 1 ? (
								<>
									<button
										type="button"
										className={styles.viewerPrevious}
										onClick={() => moveViewer(-1)}
										aria-label="Referência anterior"
										disabled={editing || saving}
									>
										<ArrowIcon direction="left" />
									</button>
									<button
										type="button"
										className={styles.viewerNext}
										onClick={() => moveViewer(1)}
										aria-label="Próxima referência"
										disabled={editing || saving}
									>
										<ArrowIcon direction="right" />
									</button>
								</>
							) : null}
						</div>

						<aside className={styles.viewerPanel}>
							<div className={styles.viewerTopbar}>
								<span className={styles.viewerCounter}>
									{selectedIndex + 1} / {visibleReferences.length}
								</span>
								<div className={styles.viewerTopActions}>
									<button
										type="button"
										className={
											favoriteIds.has(selectedReference.id)
												? styles.viewerFavoriteActive
												: styles.viewerFavorite
										}
										onClick={() => toggleFavorite(selectedReference.id)}
										disabled={saving}
										aria-pressed={favoriteIds.has(selectedReference.id)}
										aria-label={
											favoriteIds.has(selectedReference.id)
												? "Remover dos favoritos"
												: "Adicionar aos favoritos"
										}
									>
										<HeartIcon filled={favoriteIds.has(selectedReference.id)} />
									</button>
									<button
										type="button"
										className={styles.viewerClose}
										onClick={closeViewer}
										aria-label="Fechar referência"
										disabled={saving}
									>
										<span aria-hidden="true">×</span>
									</button>
								</div>
							</div>

							{editing ? (
								<form
									className={styles.viewerEditForm}
									onSubmit={saveReferenceEdit}
									aria-busy={saving}
								>
									<label className={styles.field}>
										<span>Nome</span>
										<input
											type="text"
											required
											maxLength={120}
											value={editTitle}
											onChange={(event) => setEditTitle(event.target.value)}
											disabled={saving}
										/>
									</label>
									<label className={styles.field}>
										<span>Descrição</span>
										<textarea
											rows={5}
											maxLength={320}
											value={editDescription}
											onChange={(event) => setEditDescription(event.target.value)}
											disabled={saving}
										/>
									</label>
									<div className={styles.viewerEditActions}>
										<Button
											type="button"
											variant="tertiary"
											onClick={cancelEditing}
											disabled={saving}
										>
											Cancelar
										</Button>
										<Button type="submit" variant="primary" disabled={saving}>
											{saving ? "Salvando..." : "Salvar"}
										</Button>
									</div>
								</form>
							) : (
								<div className={styles.viewerInfo}>
									<h2 id={`viewer-title-${selectedReference.id}`}>
										{selectedReference.title}
									</h2>
									{selectedReference.description ? (
										<p className={styles.viewerDescription}>
											{selectedReference.description}
										</p>
									) : (
										<p className={styles.viewerDescriptionMuted}>
											Sem descrição. A imagem fala por si.
										</p>
									)}
								</div>
							)}

							<div className={styles.viewerMeta}>
								<div>
									<span>Publicado por</span>
									<strong>{selectedReference.author}</strong>
								</div>
								<div>
									<span>Data</span>
									<time dateTime={selectedReference.createdAt}>
										{LONG_DATE_FORMATTER.format(new Date(selectedReference.createdAt))}
									</time>
								</div>
							</div>

							{confirmRemove ? (
								<fieldset className={styles.viewerRemoveConfirm}>
									<legend className={styles.visuallyHidden}>Confirmar remoção</legend>
									<div>
										<strong>Remover esta referência?</strong>
										<span>Ela some do Lembra para todo mundo.</span>
									</div>
									<div className={styles.viewerRemoveActions}>
										<Button
											type="button"
											variant="tertiary"
											onClick={() => setConfirmRemove(false)}
											disabled={saving}
										>
											Cancelar
										</Button>
										<Button
											type="button"
											variant="secondary"
											onClick={removeSelectedReference}
											disabled={saving}
										>
											{saving ? "Removendo..." : "Remover"}
										</Button>
									</div>
								</fieldset>
							) : (
								<div className={styles.viewerManageActions}>
									<button
										type="button"
										onClick={() => startEditing(selectedReference)}
										disabled={saving || editing}
									>
										Editar
									</button>
									<button
										type="button"
										className={styles.viewerDangerAction}
										onClick={() => {
											setEditing(false);
											setConfirmRemove(true);
										}}
										disabled={saving}
									>
										Remover
									</button>
								</div>
							)}

							<div className={styles.viewerHints} aria-hidden="true">
								{editing ? (
									<span>Esc cancelar edição</span>
								) : (
									<>
										<span>← → navegar</span>
										<span>Esc fechar</span>
									</>
								)}
							</div>
						</aside>
					</div>
				) : null}
			</dialog>

			<dialog
				ref={dialogRef}
				className={styles.dialog}
				onCancel={(event) => {
					event.preventDefault();
					if (!saving) closeDraft();
				}}
			>
				{draft ? (
					<form
						className={styles.composer}
						onSubmit={saveReference}
						aria-busy={saving}
					>
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
									disabled={saving}
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
									disabled={saving}
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
									disabled={saving}
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

							{uploadStatus.phase !== "idle" ? (
								<div
									className={styles.uploadStatus}
									data-phase={uploadStatus.phase}
									role="status"
									aria-live="polite"
								>
									<div className={styles.uploadStatusHeader}>
										<span>
											{uploadStatus.phase === "preparing"
												? "Preparando imagem…"
												: uploadStatus.phase === "uploading"
													? "Enviando imagem"
													: uploadStatus.phase === "finalizing"
														? "Gravando referência…"
														: uploadStatus.phase === "success"
															? "Publicado"
															: "Falha ao publicar"}
										</span>
										{uploadStatus.phase === "uploading" ? (
											<strong>
												{Math.min(
													100,
													Math.round(
														(uploadStatus.uploadedBytes /
															Math.max(1, uploadStatus.totalBytes)) *
															100,
													),
												)}
												%
											</strong>
										) : uploadStatus.phase === "success" ? (
											<strong aria-hidden="true">✓</strong>
										) : null}
									</div>

									{uploadStatus.phase === "uploading" ? (
										<progress
											className={styles.uploadProgress}
											max={100}
											value={Math.min(
												100,
												(uploadStatus.uploadedBytes /
													Math.max(1, uploadStatus.totalBytes)) *
													100,
											)}
											aria-label="Progresso do envio da imagem"
										/>
									) : uploadStatus.phase === "finalizing" ||
									  uploadStatus.phase === "success" ? (
										<div className={styles.uploadTrack} aria-hidden="true">
											<span
												className={styles.uploadTrackFill}
												style={{ width: "100%" }}
											/>
										</div>
									) : null}

									{uploadStatus.phase === "uploading" ? (
										<small>
											{formatUploadBytes(uploadStatus.uploadedBytes)} de{" "}
											{formatUploadBytes(uploadStatus.totalBytes)}
										</small>
									) : uploadStatus.phase === "finalizing" ? (
										<small>Validando imagem e publicando…</small>
									) : uploadStatus.phase === "success" ? (
										<small>Pronto. A referência já está no Lembra.</small>
									) : uploadStatus.phase === "preparing" ? (
										<small>Calculando integridade e preparando o envio.</small>
									) : null}
								</div>
							) : null}

							{message ? (
								<div
									className={styles.composerMessage}
									role="status"
									aria-live="polite"
								>
									{message}
								</div>
							) : null}

							<div className={styles.composerActions}>
								<Button
									type="button"
									variant="tertiary"
									className={styles.composerAction}
									onClick={closeDraft}
									disabled={saving}
								>
									Cancelar
								</Button>
								<Button
									type="submit"
									variant="primary"
									className={styles.composerAction}
									disabled={saving}
								>
									{uploadStatus.phase === "preparing"
										? "Preparando…"
										: uploadStatus.phase === "uploading"
											? "Enviando…"
											: uploadStatus.phase === "finalizing"
												? "Gravando…"
												: uploadStatus.phase === "success"
													? "Publicado ✓"
													: uploadStatus.phase === "error"
														? "Tentar novamente"
														: "Guardar"}
								</Button>
							</div>
						</div>
					</form>
				) : null}
			</dialog>
		</div>
	);
}
