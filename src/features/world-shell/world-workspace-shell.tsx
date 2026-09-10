"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PublicLink as Link } from "@/components/public-link";
import { ThemeToggle } from "@/components/theme-toggle";
import { WorldNavigation, WorldNavigationIntro } from "./world-navigation";
import styles from "./world-workspace-shell.module.css";

const MOBILE_NAVIGATION_FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function WorldWorkspaceShell({ children }: { children: React.ReactNode }) {
	const pathname = usePathname() || "/mundo";
	const [navigationOpen, setNavigationOpen] = useState(true);
	const [mobileNavigation, setMobileNavigation] = useState(false);
	const navigationPanelRef = useRef<HTMLElement>(null);
	const navigationCloseRef = useRef<HTMLButtonElement>(null);
	const navigationToggleRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		const desktop = window.matchMedia("(min-width: 821px)");
		const syncNavigationToViewport = () => {
			setMobileNavigation(!desktop.matches);
			setNavigationOpen(desktop.matches);
		};
		syncNavigationToViewport();
		desktop.addEventListener("change", syncNavigationToViewport);
		return () => desktop.removeEventListener("change", syncNavigationToViewport);
	}, []);

	useEffect(() => {
		const mobile = window.matchMedia("(max-width: 820px)");
		if (!navigationOpen || !mobile.matches) return;

		window.requestAnimationFrame(() => navigationCloseRef.current?.focus());

		const containNavigationFocus = (event: KeyboardEvent) => {
			// This listener can survive a mobile -> desktop resize when navigationOpen
			// remains true, so revalidate the responsive contract on every key event.
			if (!mobile.matches) return;

			if (event.key === "Escape") {
				event.preventDefault();
				setNavigationOpen(false);
				window.requestAnimationFrame(() => navigationToggleRef.current?.focus());
				return;
			}

			if (event.key !== "Tab") return;
			const panel = navigationPanelRef.current;
			if (!panel) return;
			const focusable = Array.from(
				panel.querySelectorAll<HTMLElement>(MOBILE_NAVIGATION_FOCUSABLE),
			).filter((element) => element.getAttribute("aria-hidden") !== "true");
			if (focusable.length === 0) return;

			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			const active = document.activeElement;
			if (event.shiftKey && (active === first || !panel.contains(active))) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && (active === last || !panel.contains(active))) {
				event.preventDefault();
				first.focus();
			}
		};

		document.addEventListener("keydown", containNavigationFocus);
		return () => document.removeEventListener("keydown", containNavigationFocus);
	}, [navigationOpen]);

	const navigationIsModal = navigationOpen && mobileNavigation;

	return (
		<div
			className={`${styles.workspace}${navigationOpen ? ` ${styles.navigationOpen}` : ""}`}
			data-world-workspace-root
			data-world-navigation={navigationOpen ? "open" : "closed"}
			data-testid="world-workspace"
		>
			<aside
				ref={navigationPanelRef}
				id="world-workspace-navigation"
				className={styles.navigationPanel}
				role={navigationIsModal ? "dialog" : undefined}
				aria-modal={navigationIsModal || undefined}
				aria-label="Navegação do mundo"
				aria-hidden={!navigationOpen}
				data-testid="world-workspace-navigation"
			>
				<div className={styles.navigationInner}>
					<div className={styles.navigationHeader}>
						<WorldNavigationIntro />
						<button
							ref={navigationCloseRef}
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
				aria-hidden="true"
				tabIndex={-1}
			/>

			<section
				className={styles.stage}
				data-testid="world-workspace-stage"
				aria-hidden={navigationIsModal || undefined}
				inert={navigationIsModal || undefined}
			>
				<button
					ref={navigationToggleRef}
					type="button"
					className={styles.navigationToggle}
					onClick={() => setNavigationOpen((value) => !value)}
					aria-controls="world-workspace-navigation"
					aria-expanded={navigationOpen}
					aria-hidden={navigationOpen}
					tabIndex={navigationOpen ? -1 : 0}
					aria-label={navigationOpen ? "Recolher navegação do mundo" : "Explorar universo"}
				>
					<span aria-hidden="true">{navigationOpen ? "‹" : "☰"}</span>
					<span>{navigationOpen ? "Recolher" : "Explorar universo"}</span>
				</button>
				<div className={styles.utilityControls}>
					<ThemeToggle />
				</div>
				{children}
			</section>
		</div>
	);
}
