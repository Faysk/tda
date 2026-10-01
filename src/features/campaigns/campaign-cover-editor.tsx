"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import styles from "@/app/edit/campanhas/page.module.css";

const MAX_BYTES = 8 * 1024 * 1024;

export function CampaignCoverEditor({
	campaignId,
	campaignName,
	coverImage,
	hasCoverBinding,
}: {
	campaignId: string;
	campaignName: string;
	coverImage: string | null;
	hasCoverBinding: boolean;
}) {
	const router = useRouter();
	const inputRef = useRef<HTMLInputElement>(null);
	const [busy, setBusy] = useState(false);
	const [hasBinding, setHasBinding] = useState(hasCoverBinding);
	const [message, setMessage] = useState<string | null>(null);

	async function upload() {
		const file = inputRef.current?.files?.[0];
		if (!file) {
			setMessage("Escolha uma imagem PNG ou WebP.");
			return;
		}
		if (
			(file.type !== "image/png" && file.type !== "image/webp") ||
			file.size < 24 ||
			file.size > MAX_BYTES
		) {
			setMessage("Use PNG/WebP válido com até 8 MiB.");
			return;
		}

		setBusy(true);
		setMessage(null);
		try {
			const response = await fetch(
				"/api/edit/campaign-cover/" + encodeURIComponent(campaignId),
				{
					method: "PUT",
					headers: { "Content-Type": file.type },
					body: file,
				},
			);
			const payload = (await response.json().catch(() => null)) as
				| { ok?: boolean; status?: string; reason?: string }
				| null;
			if (!response.ok || payload?.ok !== true) {
				setMessage(
					payload?.reason === "dependency_unavailable"
						? "A capa foi recusada porque o storage/read-back não fechou com segurança."
						: "Não foi possível salvar esta capa.",
				);
				return;
			}
			setHasBinding(true);
			setMessage(
				payload.status === "verified_public"
					? "Capa verificada e publicada."
					: "Capa salva em storage privado; ela só ganhará URL pública após promoção verificada.",
			);
			if (inputRef.current) inputRef.current.value = "";
			router.refresh();
		} catch {
			setMessage("Não foi possível enviar a capa agora.");
		} finally {
			setBusy(false);
		}
	}

	async function remove() {
		setBusy(true);
		setMessage(null);
		try {
			const response = await fetch(
				"/api/edit/campaign-cover/" + encodeURIComponent(campaignId),
				{ method: "DELETE" },
			);
			if (!response.ok) {
				setMessage("Não foi possível remover o vínculo da capa.");
				return;
			}
			setHasBinding(false);
			setMessage(
				"Vínculo removido. Os bytes imutáveis foram preservados para rollback/auditoria.",
			);
			router.refresh();
		} catch {
			setMessage("Não foi possível remover o vínculo da capa agora.");
		} finally {
			setBusy(false);
		}
	}

	return (
		<section className={styles.coverEditor} aria-label={`Capa de ${campaignName}`}>
			<div className={styles.coverPreview}>
				{coverImage ? (
					<Image
						src={coverImage}
						alt={`Capa atual de ${campaignName}`}
						fill
						sizes="(max-width: 760px) 100vw, 320px"
					/>
				) : (
					<span>Sem capa pública verificada</span>
				)}
			</div>
			<div className={styles.coverControls}>
				<label>
					<span>Capa/card · PNG ou WebP · até 8 MiB</span>
					<input
						ref={inputRef}
						type="file"
						accept="image/png,image/webp"
						disabled={busy}
					/>
				</label>
				<div className={styles.coverActions}>
					<button
						className={styles.secondary}
						type="button"
						onClick={upload}
						disabled={busy}
					>
						{busy ? "Validando…" : "Enviar capa"}
					</button>
					{hasBinding ? (
						<button
							className={styles.tertiary}
							type="button"
							onClick={remove}
							disabled={busy}
						>
							Remover vínculo
						</button>
					) : null}
				</div>
				{message ? (
					<p className={styles.coverStatus} role="status">
						{message}
					</p>
				) : null}
			</div>
		</section>
	);
}
