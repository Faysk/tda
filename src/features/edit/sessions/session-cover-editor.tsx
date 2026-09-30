"use client";

import Image from "next/image";
import { Progress } from "@/components/ui";
import {
	useEffect,
	useRef,
	useState,
	type ChangeEvent,
	type DragEvent,
} from "react";
import {
	finalizeSessionCoverUploadAction,
	getSessionCoverAssetStatusAction,
	requestSessionCoverUploadAction,
	sessionCoverMediaAvailabilityAction,
} from "./session-cover-media-actions";
import {
	SESSION_COVER_MEDIA_MAX_BYTES,
	type SessionCoverMediaMime,
	isExistingPublishedSessionCoverReference,
	isSessionCoverUuid,
	sessionCoverPreviewUrl,
} from "./session-cover-media";
import styles from "./editorial-draft.module.css";

type CoverMetadata = Readonly<{
	mimeType: SessionCoverMediaMime;
	bytes: number;
	width: number;
	height: number;
	status: "staged" | "verified_public";
}>;

export type SessionCoverUploadPhase =
	| "idle"
	| "hashing"
	| "uploading"
	| "finalizing"
	| "ready"
	| "error"
	| "cancelled";

export type SessionCoverUploadState = Readonly<{
	phase: SessionCoverUploadPhase;
	progress: number | null;
}>;

type Props = Readonly<{
	sessionId: string;
	value: string;
	disabled?: boolean;
	onChange: (value: string) => void;
	onUploadStateChange?: (state: SessionCoverUploadState) => void;
}>;

function hex(buffer: ArrayBuffer): string {
	return [...new Uint8Array(buffer)]
		.map((value) => value.toString(16).padStart(2, "0"))
		.join("");
}

function mimeFromFile(file: File): SessionCoverMediaMime | null {
	if (file.type === "image/png" || file.type === "image/webp")
		return file.type;
	return null;
}

function formatBytes(bytes: number): string {
	if (bytes >= 1024 * 1024)
		return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
	return `${Math.max(1, Math.round(bytes / 1024))} KiB`;
}

function safeExistingCoverUrl(value: string): string | undefined {
	const raw = value.trim();
	return isExistingPublishedSessionCoverReference(raw) ? raw : undefined;
}

function failureMessage(reason: string): string {
	switch (reason) {
		case "media_unavailable":
			return "O pipeline de mídia não está habilitado neste ambiente.";
		case "unauthenticated":
			return "Sua sessão expirou. Entre novamente antes de enviar a capa.";
		case "profile_unresolved":
		case "forbidden":
			return "Sua conta não tem permissão para alterar a capa desta sessão.";
		case "not_found":
			return "A sessão ou o asset de capa não foi encontrado neste escopo.";
		case "invalid_payload":
			return "O arquivo não atende ao contrato de capa.";
		default:
			return "Não foi possível concluir o upload. O draft atual foi preservado.";
	}
}

export function SessionCoverEditor({
	sessionId,
	value,
	disabled = false,
	onChange,
	onUploadStateChange,
}: Props) {
	const inputRef = useRef<HTMLInputElement>(null);
	const abortRef = useRef<AbortController | null>(null);
	const [available, setAvailable] = useState<boolean | null>(null);
	const [uploadState, setUploadState] = useState<SessionCoverUploadState>({
		phase: "idle",
		progress: null,
	});
	const [dragging, setDragging] = useState(false);
	const [status, setStatus] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [metadata, setMetadata] = useState<CoverMetadata | null>(null);
	const busy =
		uploadState.phase === "hashing" ||
		uploadState.phase === "uploading" ||
		uploadState.phase === "finalizing";
	const finalizing = uploadState.phase === "finalizing";
	const progress = uploadState.progress ?? 0;

	function reportUploadState(next: SessionCoverUploadState) {
		setUploadState(next);
		onUploadStateChange?.(next);
	}

	const privateAsset = isSessionCoverUuid(value);
	const previewUrl = privateAsset
		? sessionCoverPreviewUrl(sessionId, value)
		: safeExistingCoverUrl(value);

	useEffect(() => () => abortRef.current?.abort(), []);

	useEffect(() => {
		let active = true;
		void sessionCoverMediaAvailabilityAction()
			.then((enabled) => {
				if (active) setAvailable(enabled);
			})
			.catch(() => {
				if (active) setAvailable(false);
			});
		return () => {
			active = false;
		};
	}, []);

	useEffect(() => {
		let active = true;
		setMetadata(null);
		if (!privateAsset) return () => {};
		void getSessionCoverAssetStatusAction(sessionId, value)
			.then((result) => {
				if (!active) return;
				if (!result.ok) {
					setError(
						"A referência de capa privada não está mais verificável. Escolha outra imagem antes de publicar.",
					);
					return;
				}
				setMetadata({
					mimeType: result.mimeType,
					bytes: result.bytes,
					width: result.width,
					height: result.height,
					status: result.status,
				});
			})
			.catch(() => {
				if (active)
					setError("Não foi possível confirmar o estado da capa privada.");
			});
		return () => {
			active = false;
		};
	}, [privateAsset, sessionId, value]);

	async function upload(file: File) {
		if (disabled || busy) return;
		setError(null);
		setStatus(null);
		setMetadata(null);

		const mimeType = mimeFromFile(file);
		if (!mimeType) {
			reportUploadState({ phase: "error", progress: null });
			setError("Use PNG ou WebP. O servidor valida os bytes reais no finalize.");
			return;
		}
		if (file.size < 24 || file.size > SESSION_COVER_MEDIA_MAX_BYTES) {
			reportUploadState({ phase: "error", progress: null });
			setError("A capa precisa ter dados válidos e no máximo 8 MiB.");
			return;
		}

		const controller = new AbortController();
		abortRef.current = controller;
		reportUploadState({ phase: "hashing", progress: null });
		try {
			setStatus("Calculando integridade local…");
			const bytes = await file.arrayBuffer();
			const sha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
			const intent = { sha256, mimeType, bytes: file.size };

			setStatus("Preparando upload privado…");
			const requested = await requestSessionCoverUploadAction(sessionId, intent);
			if (!requested.ok) {
				reportUploadState({ phase: "error", progress: null });
				setStatus(null);
				setError(failureMessage(requested.reason));
				return;
			}

			const chunks = Math.ceil(file.size / requested.chunkBytes);
			reportUploadState({ phase: "uploading", progress: 0 });
			setStatus("Enviando nova capa…");
			for (let part = 0; part < chunks; part += 1) {
				if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
				const start = part * requested.chunkBytes;
				const end = Math.min(file.size, start + requested.chunkBytes);
				const response = await fetch("/api/edit/session-cover/upload", {
					method: "PUT",
					headers: {
						"Content-Type": "application/octet-stream",
						"X-TDA-Session": sessionId,
						"X-TDA-Upload-Id": requested.uploadId,
						"X-TDA-Content-SHA256": sha256,
						"X-TDA-Total-Bytes": String(file.size),
						"X-TDA-Part": String(part),
					},
					body: bytes.slice(start, end),
					cache: "no-store",
					credentials: "same-origin",
					signal: controller.signal,
				});
				if (!response.ok)
					throw new Error(`chunk_${response.status}`);
				reportUploadState({
					phase: "uploading",
					progress: Math.round(((part + 1) / chunks) * 100),
				});
			}

			reportUploadState({ phase: "finalizing", progress: null });
			setStatus("Validando formato, dimensões, hash e read-back…");
			const finalized = await finalizeSessionCoverUploadAction(
				sessionId,
				requested.uploadId,
				intent,
			);
			if (!finalized.ok) {
				reportUploadState({ phase: "error", progress: null });
				setStatus(null);
				setError(failureMessage(finalized.reason));
				return;
			}

			setMetadata({
				mimeType: finalized.mimeType,
				bytes: finalized.bytes,
				width: finalized.width,
				height: finalized.height,
				status: "staged",
			});
			onChange(finalized.assetId);
			reportUploadState({ phase: "ready", progress: 100 });
			setStatus("Nova capa pronta no draft. Ainda privada até a publicação.");
		} catch (uploadError) {
			if (
				uploadError instanceof DOMException &&
				uploadError.name === "AbortError"
			) {
				reportUploadState({ phase: "cancelled", progress: null });
				setStatus("Upload cancelado. A capa anterior foi preservada.");
			} else {
				console.error(
					"Session cover browser upload failed",
					uploadError instanceof Error ? uploadError.message : "unknown_error",
				);
				reportUploadState({ phase: "error", progress: null });
				setStatus(null);
				setError("O upload foi interrompido. A capa anterior foi preservada.");
			}
		} finally {
			abortRef.current = null;
			if (inputRef.current) inputRef.current.value = "";
		}
	}

	function selectFile(event: ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.item(0);
		if (file) void upload(file);
	}

	function handleDrop(event: DragEvent<HTMLButtonElement>) {
		event.preventDefault();
		setDragging(false);
		if (disabled || busy) return;
		const file = event.dataTransfer.files.item(0);
		if (file) void upload(file);
	}

	return (
		<div className={styles.sessionCoverEditor} aria-busy={busy}>
			<div className={styles.coverPreview}>
				{previewUrl ? (
					<Image
						src={previewUrl}
						alt="Preview da capa do draft"
						fill
						sizes="(max-width: 1180px) 100vw, 40vw"
						unoptimized={privateAsset}
					/>
				) : (
					<span>Sem capa no draft</span>
				)}
			</div>

			<div className={styles.coverUploadActions}>
				<button
					className={styles.coverDropZone}
					data-dragging={dragging ? "true" : "false"}
					disabled={disabled || busy || available === false}
					onClick={() => inputRef.current?.click()}
					onDragEnter={(event) => {
						event.preventDefault();
						if (!disabled && !busy) setDragging(true);
					}}
					onDragLeave={() => setDragging(false)}
					onDragOver={(event) => event.preventDefault()}
					onDrop={handleDrop}
					type="button"
				>
					<strong>
						{uploadState.phase === "hashing"
							? "Preparando capa…"
							: uploadState.phase === "uploading"
								? "Enviando capa…"
								: finalizing
									? "Validando capa…"
									: value
										? "Trocar imagem"
										: "Adicionar capa"}
					</strong>
					<span>PNG ou WebP · até 8 MiB · arraste ou clique</span>
				</button>
				{value ? (
					<button
						className={styles.controlButton}
						disabled={disabled || busy}
						onClick={() => {
							setError(null);
							setStatus(
								"Capa removida somente do draft. A versão pública atual não foi alterada.",
							);
							setMetadata(null);
							reportUploadState({ phase: "idle", progress: null });
							onChange("");
						}}
						type="button"
					>
						Remover do draft
					</button>
				) : null}
				{busy && !finalizing ? (
					<button
						className={styles.controlButton}
						onClick={() => abortRef.current?.abort()}
						type="button"
					>
						Cancelar upload
					</button>
				) : null}
			</div>

			<input
				accept="image/png,image/webp,.png,.webp"
				className={styles.visuallyHiddenInput}
				disabled={disabled || busy}
				onChange={selectFile}
				ref={inputRef}
				type="file"
			/>

			{busy ? (
				<div
					className={styles.coverOperationStatus}
					data-phase={uploadState.phase}
					role="status"
					aria-live="polite"
				>
					<strong>
						{uploadState.phase === "hashing"
							? "Preparando nova capa…"
							: uploadState.phase === "uploading"
								? `Enviando nova capa… ${progress}%`
								: "Validando nova capa…"}
					</strong>
					<span>
						{uploadState.phase === "hashing"
							? "Calculando a integridade do arquivo antes do envio."
							: uploadState.phase === "uploading"
								? "A capa atual continua preservada até o upload e a validação terminarem."
								: "Upload recebido; verificando formato, dimensões, hash e read-back."}
					</span>
					{uploadState.phase === "uploading" ? (
						<Progress
							ariaLabel="Upload da capa"
							className={styles.coverProgress}
							max={100}
							value={progress}
							valueText={`${progress}% enviado`}
						/>
					) : uploadState.phase === "hashing" ? (
						<Progress
							ariaLabel="Preparação da capa"
							className={styles.coverProgress}
							valueText="Calculando integridade local"
						/>
					) : uploadState.phase === "finalizing" ? (
						<Progress
							ariaLabel="Validação da capa"
							className={styles.coverProgress}
							valueText="Validando formato, dimensões, hash e read-back"
						/>
					) : null}
				</div>
			) : null}

			{metadata ? (
				<p
					className={styles.coverMetadata}
					data-state={uploadState.phase === "ready" ? "ready" : undefined}
				>
					{uploadState.phase === "ready" ? "✓ Nova capa pronta no draft · " : ""}
					{metadata.width}×{metadata.height} ·{" "}
					{metadata.mimeType === "image/webp" ? "WebP" : "PNG"} ·{" "}
					{formatBytes(metadata.bytes)} ·{" "}
					{metadata.status === "verified_public"
						? "asset já verificado publicamente"
						: "ainda privada — será promovida somente ao publicar"}
				</p>
			) : null}
			{available === false ? (
				<p className={styles.editorialWarning} role="status">
					Upload de mídia está desabilitado neste ambiente. A referência atual foi
					preservada.
				</p>
			) : null}
			{status && !busy ? (
				<p className={styles.coverStatus} role="status" aria-live="polite">
					{status}
				</p>
			) : null}
			{error ? (
				<p className={styles.coverError} role="alert">
					{error}
				</p>
			) : null}
		</div>
	);
}
