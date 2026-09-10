import { PublicLink as Link } from "@/components/public-link";
import styles from "./lore-home-entry.module.css";

export function LoreHomeEntry() {
	return (
		<section className={styles.entry} aria-label="Arquivo de lores">
			<Link className={styles.link} href="/lore">
				<p className={styles.eyebrow}>Arquivo cinematográfico</p>
				<h2 className={styles.title}>Histórias que ganharam outro palco.</h2>
				<span className={styles.action}>
					Explorar lores <span aria-hidden="true">→</span>
				</span>
			</Link>
		</section>
	);
}
