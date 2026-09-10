"use client";

import { PublicLink as Link } from "@/components/public-link";
import { WORLD_NAV_ITEMS, worldNavItemIsCurrent } from "./navigation-model";
import styles from "./world-shell.module.css";

export function WorldNavigation({
	pathname,
	onNavigate,
	compact = false,
}: {
	pathname: string;
	onNavigate?: () => void;
	compact?: boolean;
}) {
	return (
		<nav className={styles.navigation} aria-label="Explorar o universo da campanha">
			{WORLD_NAV_ITEMS.map((item) => {
				const current = worldNavItemIsCurrent(pathname, item.href);
				return (
					<Link
						key={item.href}
						className={`${styles.navItem}${current ? ` ${styles.navItemCurrent}` : ""}${compact ? ` ${styles.navItemCompact}` : ""}`}
						href={item.href}
						aria-current={current ? "page" : undefined}
						aria-label={compact ? item.label : undefined}
						title={compact ? `${item.label} — ${item.description}` : undefined}
						onClick={onNavigate}
					>
						<span className={styles.navMark} aria-hidden="true">
							{compact ? item.glyph : null}
						</span>
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

export function WorldNavigationIntro() {
	return (
		<div className={styles.intro}>
			<p>Arquivo vivo</p>
			<h2>Mundo da campanha</h2>
			<span>Pessoas, lugares e memórias conectadas pela história.</span>
		</div>
	);
}
