import { GlobalRouteLoading } from "@/components/global-loading";
import { PublicLink as Link } from "@/components/public-link";
import styles from "@/features/edit/permissions/permissions.module.css";

const ROWS = Array.from({ length: 4 }, (_, index) => index);

export default function LoadingPermissions() {
	return (
		<section
			className={styles.shell}
			data-permissions-loading="true"
			data-layout-family="workspace"
			data-layout-role="editorial"
			data-global-loading="off"
			aria-busy="true"
		>
			<nav className={styles.navigation} aria-label="Navegação do Edit">
				<Link href="/conta">Conta e acesso</Link>
				<Link href="/edit/sessoes">Sessões no Edit</Link>
			</nav>
			<header className={styles.header}>
				<p>TDA / EDIT</p>
				<h1>Permissões</h1>
				<GlobalRouteLoading label="Carregando dados de permissões" />
			</header>

			<div className={styles.loadingSummary} aria-hidden="true">
				<span className={`${styles.loadingBar} ${styles.loadingBarMedium}`} />
				<span className={`${styles.loadingBar} ${styles.loadingBarShort}`} />
			</div>
			<div className={styles.loadingToolbar} aria-hidden="true">
				<span className={`${styles.loadingBar} ${styles.loadingBarWide}`} />
				<span className={`${styles.loadingBar} ${styles.loadingBarMedium}`} />
				<span className={`${styles.loadingBar} ${styles.loadingBarShort}`} />
			</div>
			<div className={styles.loadingTable} aria-hidden="true">
				{ROWS.map((index) => (
					<div className={styles.loadingRow} key={index}>
						<span className={`${styles.loadingBar} ${styles.loadingBarWide}`} />
						<span className={`${styles.loadingBar} ${styles.loadingBarMedium}`} />
						<span className={`${styles.loadingBar} ${styles.loadingBarWide}`} />
						<span className={`${styles.loadingBar} ${styles.loadingBarMedium}`} />
						<span className={`${styles.loadingBar} ${styles.loadingBarShort}`} />
					</div>
				))}
			</div>
		</section>
	);
}
