"use client";

import styles from "./world-status-overlay.module.css";

type WorldStatusOverlayProps = Readonly<{
	busyNotice: string | null;
	feedback: string | null;
}>;

export function worldStatusOverlayMessage(
	busyNotice: string | null,
	feedback: string | null,
) {
	if (busyNotice) return { kind: "busy" as const, message: busyNotice };
	if (feedback) return { kind: "feedback" as const, message: feedback };
	return null;
}

export function WorldStatusOverlay({
	busyNotice,
	feedback,
}: WorldStatusOverlayProps) {
	const status = worldStatusOverlayMessage(busyNotice, feedback);
	if (!status) return null;

	return (
		<div
			className={styles.safeZone}
			data-testid="world-status-safe-zone"
			data-world-status-kind={status.kind}
			aria-live="polite"
			aria-atomic="true"
		>
			<p className={styles.message} role="status">
				<span className={styles.dot} aria-hidden="true" />
				<span>{status.message}</span>
			</p>
		</div>
	);
}
