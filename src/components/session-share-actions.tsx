"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { whatsappShareUrl } from "@/features/sessions/share";
import styles from "./session-share-actions.module.css";

type Props = Readonly<{
	title: string;
	description: string;
}>;

async function copyCurrentUrl(url: string) {
	if (navigator.clipboard?.writeText) {
		await navigator.clipboard.writeText(url);
		return true;
	}
	return false;
}

export function SessionShareActions({ title, description }: Props) {
	const [status, setStatus] = useState("");

	const share = async () => {
		const url = window.location.href;
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
			if (await copyCurrentUrl(url)) {
				setStatus("Link copiado.");
				return;
			}
		} catch {
			// Fall through to a manual copy prompt when Clipboard API is unavailable.
		}
		window.prompt("Copie o link da sessão:", url);
	};

	const shareOnWhatsApp = () => {
		const target = whatsappShareUrl({
			title,
			description,
			url: window.location.href,
		});
		window.open(target, "_blank", "noopener,noreferrer");
	};

	return (
		<fieldset className={styles.actions}>
			<legend className={styles.legend}>Compartilhar esta sessão</legend>
			<Button variant="secondary" onClick={share}>
				Compartilhar sessão
			</Button>
			<Button variant="tertiary" onClick={shareOnWhatsApp}>
				WhatsApp
			</Button>
			<p className={styles.status} aria-live="polite">
				{status}
			</p>
		</fieldset>
	);
}
