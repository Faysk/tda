"use client";

import { useEffect, useMemo, useRef } from "react";
import { usePathname } from "next/navigation";
import { PublicLink as Link } from "@/components/public-link";
import styles from "./world-shell.module.css";

type WorldNavItem = Readonly<{
	href: string;
	label: string;
	description: string;
}>;

const WORLD_NAV_ITEMS: readonly WorldNavItem[] = [
	{
		href: "/mundo",
		label: "Ecos da Jornada",
		description: "Mapa de memória",
	},
	{
		href: "/personagens",
		label: "Personagens",
		description: "Protagonistas da mesa",
	},
	{
		href: "/npcs",
		label: "NPCs",
		description: "Pessoas do mundo",
	},
	{
		href: "/lugares",
		label: "Lugares",
		description: "Territórios e destinos",
	},
	{
		href: "/faccoes",
		label: "Facções",
		description: "Grupos e forças",
	},
	{
		href: "/musicas",
		label: "Músicas",
		description: "Sons da jornada",
	},
] as const;

function itemIsCurrent(pathname: string, href: string) {
	return pathname === href || (href !== "/mundo" && pathname.startsWith(`${href}/`));
}

function WorldNav({
	pathname,
	onNavigate,
}: {
	pathname: string;
	onNavigate?: () => void;
}) {
	return (
		<nav className={styles.navigation} aria-label="Explorar o universo da campanha">
			{WORLD_NAV_ITEMS.map((item) => {
				const current = itemIsCurrent(pathname, item.href);
				return (
					<Link
						key={item.href}
						className={`${styles.navItem}${current ? ` ${styles.navItemCurrent}` : ""}`}
						href={item.href}
						aria-current={current ? "page" : undefined}
						onClick={onNavigate}
					>
						<span className={styles.navMark} aria-hidden="true" />
						<span className={styles.navCopy}>
							<strong>{item.label}</strong>
							<small>{item.description}</small>
						</span>
						<span className={styles.navArrow} aria-hidden="true">
							→
						</span>
					</Link>
				);
			})}
		</nav>
	);
}

function ShellIntro() {
	return (
		<div className={styles.intro}>
			<p>Arquivo vivo</p>
			<h2>Mundo da campanha</h2>
			<span>Pessoas, lugares e memórias conectadas pela história.</span>
		</div>
	);
}

export function WorldShell({ children }: { children: React.ReactNode }) {
	const pathname = usePathname() || "/mundo";
	const dialogRef = useRef<HTMLDialogElement>(null);
	const current = useMemo(
		() => WORLD_NAV_ITEMS.find((item) => itemIsCurrent(pathname, item.href)),
		[pathname],
	);

	useEffect(() => {
		const dialog = dialogRef.current;
		if (dialog?.open) dialog.close();
	}, [pathname]);

	const openDrawer = () => {
		const dialog = dialogRef.current;
		if (dialog && !dialog.open) dialog.showModal();
	};

	const closeDrawer = () => {
		const dialog = dialogRef.current;
		if (dialog?.open) dialog.close();
	};

	return (
		<div className={styles.shell}>
			<aside className={styles.sidebar}>
				<div className={styles.sidebarInner}>
					<ShellIntro />
					<WorldNav pathname={pathname} />
					<Link className={styles.homeLink} href="/">
						<span aria-hidden="true">←</span> Voltar ao início
					</Link>
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
					<ShellIntro />
					<button
						type="button"
						className={styles.closeButton}
						onClick={closeDrawer}
						aria-label="Fechar navegação"
					>
						×
					</button>
				</div>
				<WorldNav pathname={pathname} onNavigate={closeDrawer} />
				<Link className={styles.drawerHomeLink} href="/" onClick={closeDrawer}>
					<span aria-hidden="true">←</span> Voltar ao início
				</Link>
			</dialog>
		</div>
	);
}
