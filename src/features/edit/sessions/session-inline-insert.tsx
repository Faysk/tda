"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
	finalizeSessionInlineUploadAction,
	requestSessionInlineUploadAction,
	sessionInlineMediaAvailabilityAction,
} from "./session-inline-media-actions";
import {
	SESSION_INLINE_MEDIA_MAX_BYTES,
	SESSION_INLINE_MEDIA_UPLOAD_CHUNK_BYTES,
} from "./session-inline-media";
import styles from "./editorial-draft.module.css";

export function SessionInlineInsert({
	sessionId,
	editable,
	onInsert,
	onBusyChange,
}: {
	sessionId: string;
	editable: boolean;
	onInsert: (markdown: string) => void;
	onBusyChange: (busy: boolean) => void;
}) {
	const inputRef = useRef<HTMLInputElement>(null);
	const [available, setAvailable] = useState<boolean | null>(null);
	const [alt, setAlt] = useState("");
	const [busy, setBusy] = useState(false);
	const [progress, setProgress] = useState(0);
	const [message, setMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let mounted = true;
		void sessionInlineMediaAvailabilityAction()
			.then((value) => { if (mounted) setAvailable(value); })
			.catch(() => { if (mounted) setAvailable(false); });
		return () => { mounted = false; };
	}, []);

	async function upload(file: File) {
		if (!editable || busy || available !== true) return;
		setError(null);
		setMessage(null);
		if (file.type !== "image/png" && file.type !== "image/webp") {
			setError("Use imagens PNG ou WebP.");
			return;
		}
		if (file.size < 24 || file.size > SESSION_INLINE_MEDIA_MAX_BYTES) {
			setError("A imagem deve ter até 8 MiB.");
			return;
		}
		const description = alt.trim().replaceAll("]", "").replaceAll("\n", " ");
		if (!description || description.length > 240) {
			setError("Escreva uma descrição acessível com até 240 caracteres.");
			return;
		}
		setBusy(true);
		onBusyChange(true);
		try {
			const bytes = await file.arrayBuffer();
			const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
				.map((n) => n.toString(16).padStart(2, "0")).join("");
			const intent = { sha256, mimeType: file.type as "image/png" | "image/webp", bytes: file.size };
			const started = await requestSessionInlineUploadAction(sessionId, intent);
			if (!started.ok) throw new Error("O upload não pôde ser iniciado: " + started.reason);
			const parts = Math.ceil(file.size / started.chunkBytes);
			for (let part = 0; part < parts; part += 1) {
				const response = await fetch("/api/edit/session-inline/upload", {
					method: "PUT",
					headers: {
						"Content-Type": "application/octet-stream",
						"X-TDA-Session": sessionId,
						"X-TDA-Upload-Id": started.uploadId,
						"X-TDA-Content-SHA256": sha256,
						"X-TDA-Total-Bytes": String(file.size),
						"X-TDA-Part": String(part),
					},
					body: bytes.slice(part * SESSION_INLINE_MEDIA_UPLOAD_CHUNK_BYTES,
						Math.min(file.size, (part + 1) * SESSION_INLINE_MEDIA_UPLOAD_CHUNK_BYTES)),
					credentials: "same-origin",
					cache: "no-store",
				});
				if (!response.ok) throw new Error("Falha ao enviar imagem (" + response.status + ").");
				setProgress(Math.round(((part + 1) / parts) * 100));
			}
			const finalized = await finalizeSessionInlineUploadAction(sessionId, started.uploadId, intent);
			if (!finalized.ok) throw new Error("Falha na validação: " + finalized.reason);
			// A public URL is durable, but will not serve bytes until the session is published.
			// The title is a private-preview locator; the public reader uses the URL alone.
			onInsert("![" + description + "](" + finalized.publicUrl + ' "tda-inline:' + finalized.assetId + '")');
			setAlt("");
			setMessage("Imagem inserida no Markdown. Salve o rascunho e publique para torná-la pública.");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Não foi possível enviar a imagem.");
		} finally {
			setBusy(false);
			onBusyChange(false);
			setProgress(0);
			if (inputRef.current) inputRef.current.value = "";
		}
	}

	function onFileChange(event: ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.item(0);
		if (file) void upload(file);
	}

	return (
		<fieldset className={styles.inlineInsert} aria-label="Inserir ilustração no resumo">
			<label>
				<span>Descrição da imagem</span>
				<input
					value={alt}
					onChange={(event) => setAlt(event.target.value)}
					placeholder="Ex.: Astel treinando valsa com Talven"
					maxLength={240}
					disabled={!editable || busy}
				/>
			</label>
			<button type="button" disabled={!editable || busy || available !== true || !alt.trim()}
				onClick={() => inputRef.current?.click()}>Inserir imagem</button>
			<input ref={inputRef} className={styles.inlineFileInput} type="file"
				accept="image/png,image/webp" aria-label="Escolher ilustração da sessão"
				onChange={onFileChange} />
			{available === false ? <small role="status">Upload de imagens indisponível neste ambiente.</small> : null}
			{busy ? <small role="status">Enviando e validando imagem: {progress}%</small> : null}
			{error ? <small role="alert">{error}</small> : null}
			{message ? <small role="status">{message}</small> : null}
		</fieldset>
	);
}
