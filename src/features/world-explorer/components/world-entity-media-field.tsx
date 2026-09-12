"use client";

import Image from "next/image";
import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import {
	WORLD_ENTITY_MEDIA_MAX_BYTES,
	worldEntityMediaPreviewUrl,
} from "../world-entity-media";
import { uploadWorldEntityPortraitAction } from "../world-entity-media-actions";
import styles from "./world-entity-media-field.module.css";

function failureMessage(reason: string): string {
	switch (reason) {
		case "invalid_payload":
			return "Use uma imagem PNG ou WebP válida de até 8 MB.";
		case "lease_lost":
			return "A sessão de edição expirou. Reabra Conduzir antes de enviar a imagem.";
		case "forbidden":
		case "unauthenticated":
		case "profile_unresolved":
			return "Sua sessão não possui autorização para alterar esta imagem.";
		case "disabled":
			return "O upload de imagens ainda não está ativado neste ambiente.";
		default:
			return "Não foi possível preparar a imagem agora. A imagem anterior foi preservada.";
	}
}

export function WorldEntityMediaField({
	entityId,
	assetId,
	leaseToken,
	disabled = false,
	onAssetChange,
}: {
	entityId: string;
	assetId?: string | null;
	leaseToken: string | null;
	disabled?: boolean;
	onAssetChange: (assetId: string | null) => void;
}) {
	const inputRef = useRef<HTMLInputElement>(null);
	const [busy, setBusy] = useState(false);
	const [feedback, setFeedback] = useState<string | null>(null);
	const previewUrl = assetId ? worldEntityMediaPreviewUrl(assetId) : undefined;

	async function upload(file: File | undefined) {
		if (!file || busy || disabled || !leaseToken) return;
		if (file.size < 1 || file.size > WORLD_ENTITY_MEDIA_MAX_BYTES) {
			setFeedback("Use uma imagem PNG ou WebP válida de até 8 MB.");
			return;
		}
		setBusy(true);
		setFeedback("Validando e preservando a imagem no armazenamento de rascunho…");
		const formData = new FormData();
		formData.set("portrait", file);
		try {
			const result = await uploadWorldEntityPortraitAction(leaseToken, entityId, formData);
			if (!result.ok) {
				setFeedback(failureMessage(result.reason));
				return;
			}
			onAssetChange(result.assetId);
			setFeedback(
				`Imagem pronta no rascunho · ${result.width}×${result.height}. Ela só vira pública ao publicar o Mundo.`,
			);
		} catch {
			setFeedback("Não foi possível preparar a imagem agora. A imagem anterior foi preservada.");
		} finally {
			setBusy(false);
			if (inputRef.current) inputRef.current.value = "";
		}
	}

	function onInputChange(event: ChangeEvent<HTMLInputElement>) {
		void upload(event.target.files?.[0]);
	}

	function onDrop(event: DragEvent<HTMLLabelElement>) {
		event.preventDefault();
		void upload(event.dataTransfer.files?.[0]);
	}

	return (
		<section className={styles.field} aria-label="Imagem do elemento">
			<div className={styles.heading}>
				<strong>Imagem do elemento</strong>
				<span>Retrato principal</span>
			</div>
			<div className={styles.content}>
				<div className={styles.preview}>
					{previewUrl ? (
						<Image src={previewUrl} alt="Prévia do retrato" fill sizes="88px" unoptimized />
					) : (
						<span className={styles.empty} aria-hidden="true">✦</span>
					)}
				</div>
				<label
					className={styles.dropZone}
					data-busy={busy ? "true" : "false"}
					onDragOver={(event) => event.preventDefault()}
					onDrop={onDrop}
				>
					<strong>{assetId ? "Trocar imagem" : "Adicionar imagem"}</strong>
					<span>Arraste aqui ou escolha PNG/WebP · até 8 MB</span>
					<input
						ref={inputRef}
						type="file"
						accept="image/png,image/webp,.png,.webp"
						onChange={onInputChange}
						disabled={disabled || busy || !leaseToken}
						style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
					/>
				</label>
			</div>
			<div className={styles.actions}>
				<button
					type="button"
					onClick={() => inputRef.current?.click()}
					disabled={disabled || busy || !leaseToken}
				>
					{busy ? "Preparando…" : assetId ? "Substituir" : "Escolher arquivo"}
				</button>
				{assetId ? (
					<button
						type="button"
						onClick={() => {
							onAssetChange(null);
							setFeedback("Imagem removida do rascunho. A publicada só muda quando você publicar o Mundo.");
						}}
						disabled={disabled || busy}
					>
						Remover
					</button>
				) : null}
			</div>
			{feedback ? <p className={styles.feedback}>{feedback}</p> : null}
		</section>
	);
}
