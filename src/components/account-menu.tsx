"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import {
	useEffect,
	useMemo,
	useRef,
	useState,
	type SVGProps,
} from "react";
import {
	isCurrentNavigationPath,
	PUBLIC_NAV_ITEMS,
	type NavigationIcon,
	type NavigationItem,
	visibleToolNavigationItems,
} from "./public-navigation-model";
import { PublicLink as Link } from "./public-link";
import { ThemeToggle } from "./theme-toggle";
import {
	isAuthenticatedNavigationState,
	loadNavigationAuthProjection,
	navigationInitials,
	type NavigationAuthProjection,
} from "./navigation-auth";

const PANEL_ID = "global-profile-menu";

type PanelPhase = "closed" | "opening" | "open" | "closing";

function prefersReducedMotion() {
	return (
		typeof window !== "undefined" &&
		window.matchMedia("(prefers-reduced-motion: reduce)").matches
	);
}

function NavigationIconGlyph({
	name,
	...props
}: Readonly<{ name: NavigationIcon }> & SVGProps<SVGSVGElement>) {
	const common = {
		viewBox: "0 0 24 24",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: 1.65,
		strokeLinecap: "round" as const,
		strokeLinejoin: "round" as const,
	};
	const glyph = (() => {
		switch (name) {
			case "sessions": return <><path d="M6 4.5h12v15H6z" /><path d="M9 8h6M9 12h6M9 16h4" /></>;
			case "memory": return <><path d="M12 20s-7-4.2-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.8-7 10-7 10Z" /><path d="M9.5 11.5h5" /></>;
			case "lore": return <><path d="M5 5.5A3.5 3.5 0 0 1 8.5 2H19v16.5H8.5A3.5 3.5 0 0 0 5 22Z" /><path d="M5 5.5V22M9 7h6M9 11h6" /></>;
			case "world": return <><circle cx="12" cy="12" r="9" /><path d="M3.5 12h17M12 3c2.5 2.5 3.5 5.5 3.5 9S14.5 18.5 12 21c-2.5-2.5-3.5-5.5-3.5-9S9.5 5.5 12 3Z" /></>;
			case "characters": return <><circle cx="12" cy="8" r="3" /><path d="M5.5 20c.8-4 3-6 6.5-6s5.7 2 6.5 6" /></>;
			case "npcs": return <><circle cx="9" cy="8" r="2.5" /><circle cx="16.5" cy="9.5" r="2" /><path d="M3.5 20c.7-4 2.5-6 5.5-6s4.8 2 5.5 6M14 15c2.9 0 4.7 1.5 5.5 4.5" /></>;
			case "places": return <><path d="M12 21s6-5.5 6-11a6 6 0 1 0-12 0c0 5.5 6 11 6 11Z" /><circle cx="12" cy="10" r="2" /></>;
			case "factions": return <><path d="M5 21V4l7 3 7-3v17" /><path d="M5 16l7-3 7 3M12 7v6" /></>;
			case "quests": return <><path d="M5 4h14v16H5z" /><path d="m8 9 2 2 5-5M8 15h8" /></>;
			case "music": return <><path d="M9 18V6l9-2v12" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="15.5" cy="16" r="2.5" /></>;
			case "diary": return <><path d="M6 3h12v18H6z" /><path d="M9 3v18M11.5 8h4M11.5 12h4" /></>;
			case "transcripts": return <><path d="M4 6h16v12H8l-4 3Z" /><path d="M8 10h8M8 14h6" /></>;
			case "edit-sessions": return <><path d="M5 4h10v16H5z" /><path d="m12 16 7-7 2 2-7 7-3 1Z" /></>;
			case "process": return <><path d="M5 7h14M5 12h14M5 17h14" /><circle cx="9" cy="7" r="2" /><circle cx="15" cy="12" r="2" /><circle cx="11" cy="17" r="2" /></>;
			case "edit-world": return <><circle cx="10.5" cy="11.5" r="7.5" /><path d="M3 11.5h15M10.5 4c2 2.2 3 4.7 3 7.5M14 19l6-6 2 2-6 6-3 1Z" /></>;
			case "review": return <><path d="M4 5h12v14H4z" /><path d="m14 16 5-5 2 2-5 5-3 1Z" /><path d="M7 9h6M7 13h4" /></>;
			case "permissions": return <><circle cx="9" cy="9" r="3" /><path d="M3.5 20c.7-4 2.5-6 5.5-6 2.4 0 4 1.2 5 3.5" /><path d="m16 15 2 2 4-4M18 17v4" /></>;
		}
	})();
	return <svg aria-hidden="true" {...common} {...props}>{glyph}</svg>;
}

function NavigationList({
	items,
	pathname,
	onNavigate,
}: Readonly<{
	items: readonly NavigationItem[];
	pathname: string;
	onNavigate: () => void;
}>) {
	return (
		<ul className="product-launcher-grid">
			{items.map((item) => {
				const current = isCurrentNavigationPath(pathname, item.href);
				return (
					<li key={item.href}>
						<Link
							href={item.href}
							className="product-launcher-link"
							aria-current={current ? "page" : undefined}
							onClick={onNavigate}
						>
							<NavigationIconGlyph name={item.icon} className="product-launcher-item-icon" />
							<span>{item.label}</span>
						</Link>
					</li>
				);
			})}
		</ul>
	);
}

function AccountFallback({ initials }: Readonly<{ initials: string | null }>) {
	if (initials) return <span className="account-avatar-initials" aria-hidden="true">{initials}</span>;
	return (
		<svg className="account-avatar-silhouette" viewBox="0 0 24 24" aria-hidden="true">
			<circle cx="12" cy="8.3" r="3.4" />
			<path d="M5.2 20c.9-4.2 3.1-6.3 6.8-6.3s5.9 2.1 6.8 6.3" />
		</svg>
	);
}

export function AccountMenu() {
	const pathname = usePathname();
	const [phase, setPhase] = useState<PanelPhase>("closed");
	const [projection, setProjection] = useState<NavigationAuthProjection | null>(null);
	const [avatarFailed, setAvatarFailed] = useState(false);
	const [returnPath, setReturnPath] = useState(pathname || "/");
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const expanded = phase === "opening" || phase === "open";
	const mounted = phase !== "closed";

	useEffect(() => {
		let active = true;
		void loadNavigationAuthProjection().then((next) => {
			if (active) setProjection(next);
		});
		return () => { active = false; };
	}, []);

	useEffect(() => {
		setAvatarFailed(false);
		setReturnPath(
			typeof window === "undefined"
				? pathname || "/"
				: `${window.location.pathname}${window.location.search}${window.location.hash}`,
		);
		setPhase((current) => current === "closed" ? current : prefersReducedMotion() ? "closed" : "closing");
	}, [pathname]);

	useEffect(() => {
		if (phase !== "opening") return;
		if (prefersReducedMotion()) {
			setPhase("open");
			return;
		}
		const frame = requestAnimationFrame(() => {
			setPhase((current) => current === "opening" ? "open" : current);
		});
		return () => cancelAnimationFrame(frame);
	}, [phase]);

	const close = (restoreFocus = false) => {
		setPhase((current) => {
			if (current === "closed") return current;
			return prefersReducedMotion() ? "closed" : "closing";
		});
		if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
	};

	const toggle = () => {
		setPhase((current) => {
			if (current === "closed" || current === "closing") {
				return prefersReducedMotion() ? "open" : "opening";
			}
			return prefersReducedMotion() ? "closed" : "closing";
		});
	};

	useEffect(() => {
		if (!mounted) return;
		const onPointerDown = (event: PointerEvent) => {
			if (event.target instanceof Node && !rootRef.current?.contains(event.target)) close(false);
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			close(true);
		};
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [mounted]);

	const authenticated = projection !== null && isAuthenticatedNavigationState(projection.state);
	const capabilities = authenticated ? projection.capabilities : [];
	const tools = useMemo(() => visibleToolNavigationItems(capabilities), [capabilities]);
	const displayName = authenticated ? projection.identity?.displayName ?? null : null;
	const avatarUrl = authenticated ? projection.identity?.avatarUrl ?? null : null;
	const initials = navigationInitials(displayName);
	const showAvatar = Boolean(avatarUrl) && !avatarFailed;

	return (
		<div className="account-menu global-profile-menu" ref={rootRef}>
			<button
				ref={triggerRef}
				type="button"
				className="account-menu-trigger"
				aria-label="Abrir navegação e conta"
				aria-expanded={expanded}
				aria-controls={PANEL_ID}
				onClick={toggle}
			>
				<span className="account-avatar">
					{showAvatar && avatarUrl ? (
						<Image className="account-avatar-image" src={avatarUrl} width={40} height={40} sizes="40px" alt="" onError={() => setAvatarFailed(true)} />
					) : <AccountFallback initials={initials} />}
				</span>
			</button>

			{mounted ? (
				<section
					id={PANEL_ID}
					className="account-menu-panel global-profile-panel"
					data-state={phase}
					aria-label="Navegação, conta e aparência"
					aria-hidden={phase === "closing" ? true : undefined}
					inert={phase === "closing" ? true : undefined}
					onTransitionEnd={(event) => {
						if (event.target === event.currentTarget && phase === "closing") setPhase("closed");
					}}
				>
					<div className="global-profile-account">
						{projection === null ? (
							<p className="account-menu-status" role="status">Carregando conta…</p>
						) : projection.state === "unavailable" ? (
							<div className="account-menu-status" role="status">
								<strong>Conta temporariamente indisponível</strong>
								<span>Não foi possível verificar sua sessão agora. A navegação pública continua disponível.</span>
								<button type="button" className="account-menu-action" onClick={() => window.location.reload()}>Tentar novamente</button>
							</div>
						) : authenticated ? (
							<div className="account-menu-identity">
								<strong>{displayName ?? "Conta do Discord"}</strong>
								<span>Discord</span>
							</div>
						) : (
							<p className="account-menu-status">Entre com o Discord para acessar os espaços liberados para você.</p>
						)}

						{authenticated ? (
							<Link href="/conta" className="account-menu-action" onClick={() => close(false)}>Conta e acesso</Link>
						) : projection?.state === "anonymous" ? (
							<form action="/auth/discord" method="post">
								<input type="hidden" name="next" value={returnPath} />
								<button type="submit" className="account-menu-action account-menu-action--primary">Entrar com Discord</button>
							</form>
						) : null}

						<div className="account-menu-appearance"><span>Aparência</span><ThemeToggle /></div>
					</div>

					<nav aria-label="Navegação principal">
						<section aria-labelledby="profile-menu-explore-title">
							<h2 id="profile-menu-explore-title">Explorar</h2>
							<NavigationList items={PUBLIC_NAV_ITEMS} pathname={pathname} onNavigate={() => close(false)} />
						</section>
						{tools.length > 0 ? (
							<section className="product-launcher-tools" aria-labelledby="profile-menu-tools-title">
								<h2 id="profile-menu-tools-title">Ferramentas</h2>
								<NavigationList items={tools} pathname={pathname} onNavigate={() => close(false)} />
							</section>
						) : null}
					</nav>

					{authenticated ? (
						<form action="/auth/logout" method="post" className="global-profile-session">
							<button type="submit" className="account-menu-action account-menu-action--quiet">Sair</button>
						</form>
					) : null}
				</section>
			) : null}
		</div>
	);
}
