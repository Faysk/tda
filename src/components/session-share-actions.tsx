"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { canonicalPublicUrl } from "@/config/site";
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

function currentCanonicalUrl() {
	return canonicalPublicUrl({
		pathname: window.location.pathname,
		search: window.location.search,
		hash: window.location.hash,
	});
}

export function SessionShareActions({ title, description }: Props) {
	const [status, setStatus] = useState("");

	const share = async () => {
		const url = currentCanonicalUrl();
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

	return (
		<fieldset className={styles.actions}>
			<legend className={styles.legend}>Compartilhar esta sessão</legend>
			<Button variant="secondary" onClick={share}>
				Compartilhar sessão
			</Button>
			<p className={styles.status} aria-live="polite">
				{status}
			</p>
		</fieldset>
	);
}
