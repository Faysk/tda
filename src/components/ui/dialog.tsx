"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import styles from "./dialog.module.css";

type DialogProps = Readonly<{
	open: boolean;
	title: string;
	description?: ReactNode;
	children?: ReactNode;
	actions: ReactNode;
	onClose: () => void;
}>;

export function Dialog({
	open,
	title,
	description,
	children,
	actions,
	onClose,
}: DialogProps) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const titleId = useId();
	const descriptionId = useId();

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;

		if (!open) {
			if (dialog.open) {
				if (typeof dialog.close === "function") dialog.close();
				else dialog.removeAttribute("open");
			}
			return;
		}

		const previousFocus =
			document.activeElement instanceof HTMLElement ? document.activeElement : null;

		if (!dialog.open) {
			if (typeof dialog.showModal === "function") dialog.showModal();
			else dialog.setAttribute("open", "");
		}

		const initialFocus =
			dialog.querySelector<HTMLElement>("[data-dialog-initial-focus]") ??
			dialog.querySelector<HTMLElement>(
				'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
			);
		initialFocus?.focus();

		return () => {
			if (dialog.open) {
				if (typeof dialog.close === "function") dialog.close();
				else dialog.removeAttribute("open");
			}
			if (previousFocus?.isConnected) previousFocus.focus();
		};
	}, [open]);

	return (
		<dialog
			ref={dialogRef}
			className={styles.dialog}
			aria-modal={open ? "true" : undefined}
			aria-labelledby={titleId}
			aria-describedby={description ? descriptionId : undefined}
			onCancel={(event) => {
				event.preventDefault();
				onClose();
			}}
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<div className={styles.panel}>
				<header className={styles.header}>
					<h2 id={titleId} className={styles.title}>
						{title}
					</h2>
					{description ? (
						<div id={descriptionId} className={styles.description}>
							{description}
						</div>
					) : null}
				</header>
				{children ? <div className={styles.body}>{children}</div> : null}
				<footer className={styles.actions}>{actions}</footer>
			</div>
		</dialog>
	);
}
