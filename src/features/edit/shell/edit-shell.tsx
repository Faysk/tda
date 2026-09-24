import styles from "./edit-shell.module.css";

export function EditShell({ children }: { children: React.ReactNode }) {
	return (
		<div className={styles.shell} data-edit-shell="true">
			<div className={styles.content}>{children}</div>
		</div>
	);
}
