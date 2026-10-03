"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { canonicalPublicUrl } from "@/config/site";
import styles from "./session-share-actions.module.css";

type Props = Readonly<{
	title: string;
	description: string;
}>;

type ClipboardWriter = Readonly<{
	writeText: (text: string) => Promise<void>;
}>;

export async function copyUrlToClipboard(
	url: string,
	clipboard: ClipboardWriter | undefined,
): Promise<boolean> {
	if (!clipboard?.writeText) return false;
	await clipboard.writeText(url);
	return true;
}

function currentCanonicalUrl() {
	return canonicalPublicUrl({
		pathname: window.location.pathname,
		search: window.location.search,
		hash: window.location.hash,
	});
}

export function SessionShareActions({ title, description }: Props) {
	const [status, setStatus] = useState("");
	const [manualCopyUrl, setManualCopyUrl] = useState<string | null>(null);
	const manualInputRef = useRef<HTMLInputElement>(null);
	const manualLabelId = useId();
	const manualInputId = useId();

	useEffect(() => {
		if (!manualCopyUrl) return;
		manualInputRef.current?.focus();
		manualInputRef.current?.select();
	}, [manualCopyUrl]);

	const showManualCopy = (url: string) => {
		setManualCopyUrl(url);
		setStatus("Não foi possível copiar automaticamente. O link público está pronto para cópia manual.");
	};

	const retryCopy = async () => {
		if (!manualCopyUrl) return;
		try {
			if (await copyUrlToClipboard(manualCopyUrl, navigator.clipboard)) {
				setManualCopyUrl(null);
				setStatus("Link copiado.");
				return;
			}
		} catch {
			// Keep the selectable public URL visible when clipboard permission is denied.
		}
		setStatus("A cópia automática continua indisponível. Selecione o link abaixo e copie manualmente.");
		manualInputRef.current?.focus();
		manualInputRef.current?.select();
	};

	const share = async () => {
		const url = currentCanonicalUrl();
		setManualCopyUrl(null);
		if (navigator.share) {
			try {
				await navigator.share({ title, text: description, url });
				setStatus("Sessão compartilhada.");
				return;
			} catch (error) {
				if (error instanceof DOMException && error.name === "AbortError") return;
			}
		}

		try {
			if (await copyUrlToClipboard(url, navigator.clipboard)) {
				setStatus("Link copiado.");
				return;
			}
		} catch {
			// Fall through to the integrated manual-copy control.
		}
		showManualCopy(url);
	};

	return (
		<fieldset className={styles.actions}>
			<legend className={styles.legend}>Compartilhar esta sessão</legend>
			<Button variant="secondary" onClick={share}>
				Compartilhar sessão
			</Button>
			<p className={styles.status} aria-live="polite">
				{status}
			</p>
			{manualCopyUrl ? (
				<div className={styles.manualCopy} role="group" aria-labelledby={manualLabelId}>
					<label id={manualLabelId} className={styles.manualLabel} htmlFor={manualInputId}>
						Link público da sessão
					</label>
					<input
						ref={manualInputRef}
						id={manualInputId}
						className={styles.manualInput}
						readOnly
						value={manualCopyUrl}
						onFocus={(event) => event.currentTarget.select()}
					/>
					<p className={styles.manualHelp}>
						Use Tentar copiar novamente ou selecione o endereço e copie manualmente.
					</p>
					<div className={styles.manualActions}>
						<Button size="sm" variant="secondary" onClick={retryCopy}>
							Tentar copiar
						</Button>
						<Button
							size="sm"
							variant="tertiary"
							onClick={() => {
								setManualCopyUrl(null);
								setStatus("");
							}}
						>
							Fechar
						</Button>
					</div>
				</div>
			) : null}
		</fieldset>
	);
}
