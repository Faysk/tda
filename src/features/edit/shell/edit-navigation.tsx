"use client";

import { usePathname } from "next/navigation";
import { PublicLink as Link } from "@/components/public-link";
import styles from "./edit-shell.module.css";

const items = [
	{ href: "/edit", label: "Sessões", match: (path: string) => path === "/edit" || path.startsWith("/edit/sessoes/") },
	{ href: "/edit/processamento", label: "Processamento", match: (path: string) => path.startsWith("/edit/processamento") },
	{ href: "/edit/mundo", label: "Mundo", match: (path: string) => path.startsWith("/edit/mundo") },
] as const;

export function EditNavigation() {
	const pathname = usePathname();

	return (
		<nav className={styles.navigation} aria-label="Navegação do Edit">
			<span className={styles.navigationLabel}>Edit</span>
			{items.map((item) => {
				const active = item.match(pathname);
				return (
					<Link
						key={item.href}
						href={item.href}
						className={styles.navigationLink}
						aria-current={active ? "page" : undefined}
						data-active={active ? "true" : "false"}
					>
						{item.label}
					</Link>
				);
			})}
		</nav>
	);
}
