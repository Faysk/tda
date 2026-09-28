"use client";

import { useState } from "react";
import styles from "./access.module.css";

export function ProfileIdCopy({ profileId }: Readonly<{ profileId: string }>) {
	const [feedback, setFeedback] = useState("");

	async function copyProfileId() {
		try {
			if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
			await navigator.clipboard.writeText(profileId);
			setFeedback("ID copiado.");
		} catch {
			setFeedback("Não foi possível copiar o ID.");
		}
	}

	return (
		<div className={styles.profileIdActions}>
			<button
				type="button"
				className={styles.copyButton}
				onClick={copyProfileId}
				aria-describedby="profile-id-copy-feedback"
			>
				Copiar ID
			</button>
			<span
				id="profile-id-copy-feedback"
				className={styles.copyFeedback}
				role="status"
				aria-live="polite"
			>
				{feedback}
			</span>
		</div>
	);
}
