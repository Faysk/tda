"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { PublicLink as Link } from "@/components/public-link";
import { WorldNavigation, WorldNavigationIntro } from "./world-navigation";
import styles from "./world-workspace-shell.module.css";

export function WorldWorkspaceShell({ children }: { children: React.ReactNode }) {
	const pathname = usePathname() || "/mundo";
	const [navigationOpen, setNavigationOpen] = useState(false);

	useEffect(() => {
		if (window.matchMedia("(min-width: 821px)").matches) {
			setNavigationOpen(true);
		}
	}, []);

	return (
		<div
			className={`${styles.workspace}${navigationOpen ? ` ${styles.navigationOpen}` : ""}`}
			data-world-workspace-root
			data-world-navigation={navigationOpen ? "open" : "closed"}
			data-testid="world-workspace"
		>
			<aside
				id="world-workspace-navigation"
				className={styles.navigationPanel}
				aria-hidden={!navigationOpen}
				data-testid="world-workspace-navigation"
			>
				<div className={styles.navigationInner}>
					<div className={styles.navigationHeader}>
						<WorldNavigationIntro />
						<button
							type="button"
							className={styles.closeNavigation}
							onClick={() => setNavigationOpen(false)}
							aria-label="Recolher navegação do mundo"
						>
							×
						</button>
					</div>
					<WorldNavigation pathname={pathname} />
					<Link className={styles.homeLink} href="/">
						<span aria-hidden="true">←</span>
						Voltar ao início
					</Link>
				</div>
			</aside>

			<button
				type="button"
				className={styles.mobileBackdrop}
				onClick={() => setNavigationOpen(false)}
				aria-label="Fechar navegação do mundo"
				tabIndex={navigationOpen ? 0 : -1}
			/>

			<section className={styles.stage} data-testid="world-workspace-stage">
				<button
					type="button"
					className={styles.navigationToggle}
					onClick={() => setNavigationOpen((value) => !value)}
					aria-controls="world-workspace-navigation"
					aria-expanded={navigationOpen}
					aria-label={
						navigationOpen
							? "Recolher navegação do mundo"
							: "Explorar universo"
					}
				>
					<span aria-hidden="true">{navigationOpen ? "‹" : "☰"}</span>
					<span>{navigationOpen ? "Recolher" : "Explorar universo"}</span>
				</button>
				{children}
			</section>
		</div>
	);
}
