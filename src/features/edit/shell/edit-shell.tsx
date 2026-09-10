import Image from "next/image";
import { PublicLink as Link } from "@/components/public-link";
import { ThemeToggle } from "@/components/theme-toggle";
import { EditNavigation } from "./edit-navigation";
import styles from "./edit-shell.module.css";

export function EditShell({ children }: { children: React.ReactNode }) {
	return (
		<div className={styles.shell} data-edit-shell="true">
			<aside className={styles.rail} aria-label="Área de trabalho do Edit">
				<Link
					href="/"
					className={styles.brand}
					aria-label="TDA — voltar ao site"
				>
					<span className={styles.brandMark} aria-hidden="true">
						<Image
							className="brand-symbol-image brand-symbol-image--dark"
							src="/brand/tda-mark-white.svg"
							width={42}
							height={42}
							alt=""
						/>
						<Image
							className="brand-symbol-image brand-symbol-image--light"
							src="/brand/tda-mark-black.svg"
							width={42}
							height={42}
							alt=""
						/>
					</span>
					<span className={styles.brandCopy}>
						<strong>TDA</strong>
						<small>Edit</small>
					</span>
				</Link>

				<EditNavigation />

				<div className={styles.railFooter}>
					<ThemeToggle />
				</div>
			</aside>
			<div className={styles.content}>{children}</div>
		</div>
	);
}
