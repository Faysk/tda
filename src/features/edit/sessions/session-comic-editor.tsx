"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
	finalizeSessionComicUploadAction,
	requestSessionComicUploadAction,
	sessionComicMediaAvailabilityAction,
} from "./session-comic-media-actions";
import {
	SESSION_COMIC_MEDIA_MAX_BYTES,
	SESSION_COMIC_MEDIA_UPLOAD_CHUNK_BYTES,
	sessionComicPreviewUrl,
} from "./session-comic-media";
import {
	SESSION_COMIC_LIMITS,
	type SessionComicDraftPage,
} from "./session-comic-model";
import styles from "./session-comic-editor.module.css";

type Props = Readonly<{
	sessionId: string;
	pages: readonly SessionComicDraftPage[];
	editable: boolean;
	onChange: (pages: readonly SessionComicDraftPage[]) => void;
	onBusyChange?: (busy: boolean) => void;
}>;

type Progress = Readonly<{
	filename: string;
	completed: number;
	total: number;
	percent: number;
}>;

function hex(data: ArrayBuffer): string {
	return [...new Uint8Array(data)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

export function SessionComicEditor({
	sessionId,
	pages,
	editable,
	onChange,
	onBusyChange,
}: Props) {
	const inputRef = useRef<HTMLInputElement>(null);
	const controllerRef = useRef<AbortController | null>(null);
	const pagesRef = useRef(pages);
	const [available, setAvailable] = useState<boolean | null>(null);
	const [busy, setBusy] = useState(false);
	const [progress, setProgress] = useState<Progress | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [message, setMessage] = useState<string | null>(null);

	useEffect(() => {
		pagesRef.current = pages;
	}, [pages]);

	useEffect(() => {
		let active = true;
		void sessionComicMediaAvailabilityAction()
			.then((state) => {
				if (active) setAvailable(state);
			})
			.catch(() => {
				if (active) setAvailable(false);
			});
		return () => {
			active = false;
		};
	}, []);

	useEffect(() => () => controllerRef.current?.abort(), []);

	function change(next: readonly SessionComicDraftPage[]) {
		pagesRef.current = next;
		onChange(next);
	}

	function editAt(
		index: number,
		update: (page: SessionComicDraftPage) => SessionComicDraftPage,
	) {
		if (!editable || busy) return;
		change(pagesRef.current.map((page, i) => (i === index ? update(page) : page)));
	}

	function move(index: number, direction: -1 | 1) {
		if (!editable || busy) return;
		const to = index + direction;
		if (to < 0 || to >= pagesRef.current.length) return;
		const reordered = [...pagesRef.current];
		[reordered[index], reordered[to]] = [reordered[to], reordered[index]];
		change(reordered);
	}

	async function addFiles(files: FileList | null) {
		if (!files || !files.length || busy || !editable || available !== true) return;
		if (pagesRef.current.length + files.length > SESSION_COMIC_LIMITS.pages) {
			setError("A HQ excederia o limite de páginas desta sessão.");
			return;
		}

		const controller = new AbortController();
		controllerRef.current = controller;
		setBusy(true);
		onBusyChange?.(true);
		setError(null);
		setMessage(null);

		try {
			for (const [index, file] of Array.from(files).entries()) {
				if (controller.signal.aborted) throw new DOMException("Cancelled", "AbortError");
				setProgress({
					filename: file.name,
					completed: index,
					total: files.length,
					percent: 0,
				});
				if (file.type !== "image/png" && file.type !== "image/webp") {
					throw new Error("Use imagens PNG ou WebP. Arquivo recusado: " + file.name);
				}
				if (file.size < 24 || file.size > SESSION_COMIC_MEDIA_MAX_BYTES) {
					throw new Error("A imagem deve ter até 8 MiB: " + file.name);
				}

				const data = await file.arrayBuffer();
				const sha256 = hex(await crypto.subtle.digest("SHA-256", data));
				const intent = {
					sha256,
					mimeType: file.type as "image/png" | "image/webp",
					bytes: file.size,
				};
				const requested = await requestSessionComicUploadAction(sessionId, intent);
				if (!requested.ok) {
					throw new Error("Não foi possível iniciar o upload: " + requested.reason);
				}
				const chunks = Math.ceil(file.size / requested.chunkBytes);
				for (let part = 0; part < chunks; part += 1) {
					if (controller.signal.aborted) throw new DOMException("Cancelled", "AbortError");
					const response = await fetch("/api/edit/session-comic/upload", {
						method: "PUT",
						headers: {
							"Content-Type": "application/octet-stream",
							"X-TDA-Session": sessionId,
							"X-TDA-Upload-Id": requested.uploadId,
							"X-TDA-Content-SHA256": sha256,
							"X-TDA-Total-Bytes": String(file.size),
							"X-TDA-Part": String(part),
						},
						body: data.slice(
							part * SESSION_COMIC_MEDIA_UPLOAD_CHUNK_BYTES,
							Math.min(file.size, (part + 1) * SESSION_COMIC_MEDIA_UPLOAD_CHUNK_BYTES),
						),
						cache: "no-store",
						credentials: "same-origin",
						signal: controller.signal,
					});
					if (!response.ok) throw new Error("Falha no envio: " + response.status);
					setProgress({
						filename: file.name,
						completed: index,
						total: files.length,
						percent: Math.round(((part + 1) / chunks) * 100),
					});
				}
				const finalized = await finalizeSessionComicUploadAction(
					sessionId,
					requested.uploadId,
					intent,
				);
				if (!finalized.ok)
					throw new Error("Não foi possível validar a imagem: " + finalized.reason);
				if (pagesRef.current.some((page) => page.assetId === finalized.assetId))
					throw new Error("Esta imagem já pertence à HQ: " + file.name);
				change([
					...pagesRef.current,
					{ assetId: finalized.assetId, altText: "", caption: "" },
				]);
			}
			setMessage(
				"Imagens preparadas no armazenamento privado. Salve o rascunho antes de publicar.",
			);
		} catch (err) {
			if (err instanceof DOMException && err.name === "AbortError") {
				setMessage("Upload cancelado. As páginas já concluídas foram preservadas.");
			} else {
				setError(err instanceof Error ? err.message : "O upload foi interrompido.");
			}
		} finally {
			controllerRef.current = null;
			setBusy(false);
			onBusyChange?.(false);
			setProgress(null);
			if (inputRef.current) inputRef.current.value = "";
		}
	}

	function onFileChange(event: ChangeEvent<HTMLInputElement>) {
		void addFiles(event.target.files);
	}

	return (
		<section className={styles.editor} aria-label="Páginas da HQ">
			<div className={styles.toolbar}>
				<div>
					<strong>HQ da sessão</strong>
					<p>Organize páginas já prontas, na ordem em que serão lidas.</p>
				</div>
				<button
					type="button"
					disabled={!editable || busy || available !== true}
					onClick={() => inputRef.current?.click()}
				>
					Adicionar imagens
				</button>
				<input
					className={styles.hiddenInput}
					ref={inputRef}
					type="file"
					multiple
					accept="image/png,image/webp"
					onChange={onFileChange}
					aria-label="Selecionar páginas da HQ"
				/>
			</div>
			<p className={styles.hint}>PNG ou WebP, até 8 MiB por imagem. As imagens ficam privadas até à publicação.</p>
			{available === false ? <p role="status">O armazenamento de imagens não está disponível neste ambiente.</p> : null}
			{progress ? (
				<div role="status" className={styles.progress}>
					Enviando {progress.filename} — {progress.completed + 1} de {progress.total}, {progress.percent}%
					<progress value={progress.percent} max={100} />
					<button type="button" onClick={() => controllerRef.current?.abort()}>
						Cancelar envio
					</button>
				</div>
			) : null}
			{error ? <p role="alert" className={styles.error}>{error}</p> : null}
			{message ? <p role="status">{message}</p> : null}
			{pages.length === 0 ? (
				<p className={styles.empty}>Esta sessão ainda não tem páginas de HQ.</p>
			) : (
				<ol className={styles.pages}>
					{pages.map((page, index) => (
						<li className={styles.page} key={page.assetId}>
							<div className={styles.thumbnail}>
								{sessionComicPreviewUrl(sessionId, page.assetId) ? (
									<Image
										alt=""
										src={sessionComicPreviewUrl(sessionId, page.assetId) ?? ""}
										fill
										unoptimized
										sizes="144px"
									/>
								) : null}
							</div>
							<div className={styles.fields}>
								<strong>Página {index + 1}</strong>
								<label>
									Descrição acessível
									<input
										value={page.altText}
										maxLength={SESSION_COMIC_LIMITS.altText}
										disabled={!editable || busy}
										onChange={(event) =>
											editAt(index, (current) => ({
												...current,
												altText: event.target.value,
											}))
										}
									/>
								</label>
								<label>
									Legenda (opcional)
									<input
										value={page.caption}
										maxLength={SESSION_COMIC_LIMITS.caption}
										disabled={!editable || busy}
										onChange={(event) =>
											editAt(index, (current) => ({
												...current,
												caption: event.target.value,
											}))
										}
									/>
								</label>
							</div>
							<div className={styles.controls}>
								<button
									type="button"
									aria-label={"Subir página " + (index + 1)}
									disabled={!editable || busy || index === 0}
									onClick={() => move(index, -1)}
								>
									↑
								</button>
								<button
									type="button"
									aria-label={"Descer página " + (index + 1)}
									disabled={!editable || busy || index === pages.length - 1}
									onClick={() => move(index, 1)}
								>
									↓
								</button>
								<button
									type="button"
									aria-label={"Remover página " + (index + 1)}
									disabled={!editable || busy}
									onClick={() =>
										change(pagesRef.current.filter((_, i) => i !== index))
									}
								>
									Remover
								</button>
							</div>
						</li>
					))}
				</ol>
			)}
		</section>
	);
}
