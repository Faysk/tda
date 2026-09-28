"use client";

import { useState } from "react";
import styles from "@/features/auth/access.module.css";

type CopyState = "idle" | "copied" | "error";

export function CopyProfileId({ profileId }: Readonly<{ profileId: string }>) {
	const [state, setState] = useState<CopyState>("idle");

	const copy = async () => {
		try {
			if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
			await navigator.clipboard.writeText(profileId);
			setState("copied");
		} catch {
			setState("error");
		}
	};

	return (
		<div className={styles.copyControl}>
			<button className={styles.copyButton} type="button" onClick={copy}>
				Copiar ID
			</button>
			<span className={styles.copyFeedback} role="status" aria-live="polite">
				{state === "copied"
					? "ID copiado."
					: state === "error"
						? "Não foi possível copiar."
						: ""}
			</span>
		</div>
	);
}
