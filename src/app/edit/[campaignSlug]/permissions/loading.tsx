import styles from "@/features/edit/permissions/permissions.module.css";

export default function LoadingPermissions() {
	return (
		<section className={styles.shell} aria-busy="true">
			<h1>Permissões</h1>
			<p role="status">Verificando acesso e carregando permissões…</p>
		</section>
	);
}
