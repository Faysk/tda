"use client";

import { useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { PublicLink as Link } from "@/components/public-link";
import { WORLD_NAV_ITEMS, worldNavItemIsCurrent } from "./navigation-model";
import { WorldNavigation, WorldNavigationIntro } from "./world-navigation";
import polish from "./world-shell-polish.module.css";
import styles from "./world-shell.module.css";

export function WorldShell({ children }: { children: React.ReactNode }) {
	const pathname = usePathname() || "/mundo";
	const dialogRef = useRef<HTMLDialogElement>(null);
	const [railCollapsed, setRailCollapsed] = useState(false);
	const current = useMemo(
		() => WORLD_NAV_ITEMS.find((item) => worldNavItemIsCurrent(pathname, item.href)),
		[pathname],
	);

	const openDrawer = () => {
		const dialog = dialogRef.current;
		if (dialog && !dialog.open) dialog.showModal();
	};

	const closeDrawer = () => {
		const dialog = dialogRef.current;
		if (dialog?.open) dialog.close();
	};

	return (
		<div
			className={`${styles.shell}${railCollapsed ? ` ${styles.shellCollapsed} ${polish.shellCollapsed}` : ""}`}
		>
			<aside className={styles.sidebar}>
				<div className={styles.sidebarInner}>
					{railCollapsed ? null : <WorldNavigationIntro />}
					<WorldNavigation pathname={pathname} compact={railCollapsed} />
					<div className={styles.sidebarFooter}>
						<button
							type="button"
							className={styles.railToggle}
							onClick={() => setRailCollapsed((value) => !value)}
							aria-expanded={!railCollapsed}
							aria-label={
								railCollapsed
									? "Explorar universo"
									: "Recolher navegação do mundo"
							}
							title={railCollapsed ? "Explorar universo" : "Recolher navegação"}
						>
							<span aria-hidden="true">{railCollapsed ? "☰" : "‹"}</span>
							{railCollapsed ? null : <span>Recolher</span>}
						</button>
						<Link
							className={`${styles.homeLink}${railCollapsed ? ` ${styles.homeLinkCompact}` : ""}`}
							href="/"
							aria-label={railCollapsed ? "Voltar ao início" : undefined}
							title={railCollapsed ? "Voltar ao início" : undefined}
						>
							<span aria-hidden="true">←</span>
							{railCollapsed ? null : "Voltar ao início"}
						</Link>
					</div>
				</div>
			</aside>

			<div className={styles.stage}>
				<div className={styles.mobileBar}>
					<button
						type="button"
						className={styles.menuButton}
						onClick={openDrawer}
						aria-haspopup="dialog"
					>
						<span className={styles.menuIcon} aria-hidden="true">
							<span />
							<span />
							<span />
						</span>
						<span>Explorar universo</span>
					</button>
					<span className={styles.currentSection}>{current?.label ?? "Mundo"}</span>
				</div>
				<div className={styles.content}>{children}</div>
			</div>

			<dialog
				ref={dialogRef}
				className={styles.drawer}
				aria-label="Navegação do universo da campanha"
			>
				<div className={styles.drawerHeader}>
					<WorldNavigationIntro />
					<button
						type="button"
						className={styles.closeButton}
						onClick={closeDrawer}
						aria-label="Fechar navegação"
					>
						×
					</button>
				</div>
				<WorldNavigation pathname={pathname} onNavigate={closeDrawer} />
				<Link className={styles.drawerHomeLink} href="/" onClick={closeDrawer}>
					<span aria-hidden="true">←</span> Voltar ao início
				</Link>
			</dialog>
		</div>
	);
}
