"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type RefObject,
} from "react";
import { NavigationIconGlyph } from "./public-nav";
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
const PANEL_MOTION_SAFETY_MS = 2_250;
const PRIMARY_PUBLIC_HREFS = ["/sessoes", "/mundo", "/lore", "/lembra"] as const;
const WORLD_PUBLIC_HREFS = [
	"/personagens",
	"/npcs",
	"/lugares",
	"/faccoes",
	"/quests",
	"/musicas",
	"/diario",
] as const;

type PanelPhase = "closed" | "opening" | "open" | "closing";
type PanelView = "root" | "world" | "tools";

function prefersReducedMotion() {
	return (
		typeof window !== "undefined" &&
		window.matchMedia("(prefers-reduced-motion: reduce)").matches
	);
}

function navigationItemsForHrefs(hrefs: readonly string[]) {
	return hrefs.flatMap((href) => {
		const item = PUBLIC_NAV_ITEMS.find((candidate) => candidate.href === href);
		return item ? [item] : [];
	});
}

const PRIMARY_PUBLIC_ITEMS = navigationItemsForHrefs(PRIMARY_PUBLIC_HREFS);
const WORLD_PUBLIC_ITEMS = navigationItemsForHrefs(WORLD_PUBLIC_HREFS);
const WORLD_ROOT_ITEM = PUBLIC_NAV_ITEMS.find((item) => item.href === "/mundo");

function AccountFallback({
	initials,
}: Readonly<{ initials: string | null }>) {
	if (initials) {
		return (
			<span className="account-avatar-initials" aria-hidden="true">
				{initials}
			</span>
		);
	}

	return (
		<svg
			className="account-avatar-silhouette"
			viewBox="0 0 24 24"
			aria-hidden="true"
		>
			<circle cx="12" cy="8.3" r="3.4" />
			<path d="M5.2 20c.9-4.2 3.1-6.3 6.8-6.3s5.9 2.1 6.8 6.3" />
		</svg>
	);
}

function NavigationRowLink({
	item,
	pathname,
	onNavigate,
	label,
}: Readonly<{
	item: NavigationItem;
	pathname: string;
	onNavigate: () => void;
	label?: string;
}>) {
	const current = isCurrentNavigationPath(pathname, item.href);
	return (
		<li>
			<Link
				href={item.href}
				className="global-nav-row global-nav-row--link"
				aria-current={current ? "page" : undefined}
				onClick={onNavigate}
			>
				<NavigationIconGlyph name={item.icon} className="global-nav-row-icon" />
				<span className="global-nav-row-label">{label ?? item.label}</span>
			</Link>
		</li>
	);
}

function DrilldownButton({
	label,
	icon,
	current,
	buttonRef,
	onClick,
}: Readonly<{
	label: string;
	icon: NavigationIcon;
	current: boolean;
	buttonRef: RefObject<HTMLButtonElement | null>;
	onClick: () => void;
}>) {
	return (
		<li>
			<button
				ref={buttonRef}
				type="button"
				className="global-nav-row global-nav-row--drilldown"
				data-current={current ? "true" : undefined}
				onClick={onClick}
			>
				<NavigationIconGlyph name={icon} className="global-nav-row-icon" />
				<span className="global-nav-row-label">{label}</span>
				<span className="global-nav-row-chevron" aria-hidden="true">
					›
				</span>
			</button>
		</li>
	);
}

export function AccountMenu() {
	const pathname = usePathname();
	const [phase, setPhase] = useState<PanelPhase>("closed");
	const [view, setView] = useState<PanelView>("root");
	const [projection, setProjection] = useState<NavigationAuthProjection | null>(
		null,
	);
	const [avatarFailed, setAvatarFailed] = useState(false);
	const [returnPath, setReturnPath] = useState(pathname || "/");
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const backButtonRef = useRef<HTMLButtonElement>(null);
	const worldButtonRef = useRef<HTMLButtonElement>(null);
	const toolsButtonRef = useRef<HTMLButtonElement>(null);
	const mounted = phase !== "closed";
	const expanded = phase === "opening" || phase === "open";

	const close = useCallback((restoreFocus = false) => {
		setPhase((current) => {
			if (current === "closed") return current;
			return prefersReducedMotion() ? "closed" : "closing";
		});
		if (restoreFocus) {
			requestAnimationFrame(() => triggerRef.current?.focus());
		}
	}, []);

	const closeAfterNavigate = useCallback(() => close(false), [close]);

	const toggle = useCallback(() => {
		const opening = phase === "closed" || phase === "closing";
		if (opening) setView("root");
		setPhase(
			opening
				? prefersReducedMotion()
					? "open"
					: "opening"
				: prefersReducedMotion()
					? "closed"
					: "closing",
		);
	}, [phase]);

	const enterView = useCallback((next: Exclude<PanelView, "root">) => {
		setView(next);
		requestAnimationFrame(() => backButtonRef.current?.focus());
	}, []);

	const returnToRoot = useCallback(
		(origin: Exclude<PanelView, "root">) => {
			setView("root");
			requestAnimationFrame(() => {
				(origin === "world" ? worldButtonRef : toolsButtonRef).current?.focus();
			});
		},
		[],
	);

	const tools = useMemo(
		() => visibleToolNavigationItems(projection?.capabilities ?? []),
		[projection],
	);

	useEffect(() => {
		let active = true;
		void loadNavigationAuthProjection().then((next) => {
			if (active) setProjection(next);
		});
		return () => {
			active = false;
		};
	}, []);

	useEffect(() => {
		close(false);
		setView("root");
		setAvatarFailed(false);
		setReturnPath(
			typeof window === "undefined"
				? pathname || "/"
				: window.location.pathname + window.location.search + window.location.hash,
		);
	}, [pathname, close]);

	useEffect(() => {
		if (phase !== "opening" || prefersReducedMotion()) return;
		const frame = requestAnimationFrame(() => {
			setPhase((current) => (current === "opening" ? "open" : current));
		});
		return () => cancelAnimationFrame(frame);
	}, [phase]);

	useEffect(() => {
		if (phase !== "closing" || prefersReducedMotion()) return;
		const timeout = window.setTimeout(() => {
			setPhase((current) => (current === "closing" ? "closed" : current));
		}, PANEL_MOTION_SAFETY_MS);
		return () => window.clearTimeout(timeout);
	}, [phase]);

	useEffect(() => {
		if (!mounted) return;

		const onPointerDown = (event: PointerEvent) => {
			if (
				event.target instanceof Node &&
				!rootRef.current?.contains(event.target)
			) {
				close(false);
			}
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || !expanded) return;
			event.preventDefault();
			close(true);
		};

		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [mounted, expanded, close]);

	const authenticated =
		projection !== null && isAuthenticatedNavigationState(projection.state);
	const displayName = authenticated ? projection.identity?.displayName ?? null : null;
	const avatarUrl = authenticated ? projection.identity?.avatarUrl ?? null : null;
	const initials = navigationInitials(displayName);
	const showAvatar = Boolean(avatarUrl) && !avatarFailed;
	const worldCurrent =
		isCurrentNavigationPath(pathname, "/mundo") ||
		WORLD_PUBLIC_ITEMS.some((item) =>
			isCurrentNavigationPath(pathname, item.href),
		);
	const toolsCurrent = tools.some(
		(item) =>
			item.href !== "/mundo" && isCurrentNavigationPath(pathname, item.href),
	);

	return (
		<div className="account-menu" ref={rootRef}>
			<button
				ref={triggerRef}
				type="button"
				className="account-menu-trigger"
				aria-label="Abrir menu global"
				aria-expanded={expanded}
				aria-controls={PANEL_ID}
				onClick={toggle}
			>
				<span className="account-avatar">
					{showAvatar && avatarUrl ? (
						<Image
							className="account-avatar-image"
							src={avatarUrl}
							width={40}
							height={40}
							sizes="40px"
							alt=""
							onError={() => setAvatarFailed(true)}
						/>
					) : (
						<AccountFallback initials={initials} />
					)}
				</span>
			</button>

			{mounted ? (
				<section
					className="account-menu-panel"
					id={PANEL_ID}
					data-state={phase}
					data-view={view}
					aria-label="Navegação, conta e aparência"
					aria-hidden={phase === "closing" ? true : undefined}
					inert={phase === "closing" ? true : undefined}
					onTransitionEnd={(event) => {
						if (
							event.target === event.currentTarget &&
							event.propertyName === "opacity" &&
							phase === "closing"
						) {
							setPhase("closed");
						}
					}}
				>
					<nav className="account-menu-navigation" aria-label="Navegação principal">
						{view === "root" ? (
							<div className="global-nav-view" data-view="root">
								<h2 id="global-menu-public-title">Explorar</h2>
								<ul
									className="global-nav-list"
									aria-labelledby="global-menu-public-title"
								>
									{PRIMARY_PUBLIC_ITEMS.map((item) =>
										item.href === "/mundo" ? (
											<DrilldownButton
												key={item.href}
												label={item.label}
												icon={item.icon}
												current={worldCurrent}
												buttonRef={worldButtonRef}
												onClick={() => enterView("world")}
											/>
										) : (
											<NavigationRowLink
												key={item.href}
												item={item}
												pathname={pathname}
												onNavigate={closeAfterNavigate}
											/>
										),
									)}
									{tools.length > 0 ? (
										<DrilldownButton
											label="Ferramentas"
											icon="process"
											current={toolsCurrent}
											buttonRef={toolsButtonRef}
											onClick={() => enterView("tools")}
										/>
									) : null}
								</ul>
							</div>
						) : view === "world" ? (
							<div className="global-nav-view" data-view="world">
								<div className="global-nav-context">
									<button
										ref={backButtonRef}
										type="button"
										className="global-nav-back"
										aria-label="Voltar para Explorar"
										onClick={() => returnToRoot("world")}
									>
										<span aria-hidden="true">←</span>
										<span>Explorar</span>
									</button>
									<h2>Mundo</h2>
								</div>
								<ul className="global-nav-list" aria-label="Explorar Mundo">
									{WORLD_ROOT_ITEM ? (
										<NavigationRowLink
											item={WORLD_ROOT_ITEM}
											pathname={pathname}
											onNavigate={closeAfterNavigate}
											label="Explorar tudo"
										/>
									) : null}
									{WORLD_PUBLIC_ITEMS.map((item) => (
										<NavigationRowLink
											key={item.href}
											item={item}
											pathname={pathname}
											onNavigate={closeAfterNavigate}
										/>
									))}
								</ul>
							</div>
						) : (
							<div className="global-nav-view" data-view="tools">
								<div className="global-nav-context">
									<button
										ref={backButtonRef}
										type="button"
										className="global-nav-back"
										aria-label="Voltar para Explorar"
										onClick={() => returnToRoot("tools")}
									>
										<span aria-hidden="true">←</span>
										<span>Explorar</span>
									</button>
									<h2>Ferramentas</h2>
								</div>
								<ul className="global-nav-list" aria-label="Ferramentas autorizadas">
									{tools.map((item) => (
										<NavigationRowLink
											key={item.href + item.label}
											item={item}
											pathname={pathname}
											onNavigate={closeAfterNavigate}
										/>
									))}
								</ul>
							</div>
						)}
					</nav>

					{view === "root" ? (
						<div className="account-menu-utility">
							<div className="account-menu-account-block">
								{projection === null ? (
									<p className="account-menu-status" role="status">
										Carregando conta…
									</p>
								) : projection.state === "unavailable" ? (
									<div className="account-menu-status" role="status">
										<strong>Conta temporariamente indisponível</strong>
										<span>
											Não foi possível verificar sua sessão agora. A navegação
											pública continua disponível.
										</span>
										<button
											type="button"
											className="account-menu-action"
											onClick={() => window.location.reload()}
										>
											Tentar novamente
										</button>
									</div>
								) : authenticated ? (
									<div className="account-menu-identity">
										<strong>{displayName ?? "Conta do Discord"}</strong>
										<span>Discord</span>
									</div>
								) : (
									<p className="account-menu-status">
										Entre com o Discord para acessar os espaços liberados para você.
									</p>
								)}

								{authenticated ? (
									<Link
										href="/conta"
										className="account-menu-action"
										onClick={closeAfterNavigate}
									>
										Conta e acesso
									</Link>
								) : projection?.state === "anonymous" ? (
									<form action="/auth/discord" method="post">
										<input type="hidden" name="next" value={returnPath} />
										<button
											type="submit"
											className="account-menu-action account-menu-action--primary"
										>
											Entrar com Discord
										</button>
									</form>
								) : null}

								<div className="account-menu-appearance">
									<span>Aparência</span>
									<ThemeToggle />
								</div>
							</div>

							{authenticated ? (
								<form action="/auth/logout" method="post">
									<button
										type="submit"
										className="account-menu-action account-menu-action--quiet"
									>
										Sair
									</button>
								</form>
							) : null}
						</div>
					) : null}
				</section>
			) : null}
		</div>
	);
}
