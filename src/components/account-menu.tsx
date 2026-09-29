"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PublicLink as Link } from "./public-link";
import { NavigationIconGlyph } from "./public-nav";
import {
	isCurrentNavigationPath,
	PRIMARY_PUBLIC_NAV_ITEMS,
	type NavigationItem,
	visibleToolNavigationItems,
	WORLD_NAV_ITEMS,
} from "./public-navigation-model";
import { ThemeToggle } from "./theme-toggle";
import {
	isAuthenticatedNavigationState,
	loadNavigationAuthProjection,
	navigationInitials,
	type NavigationAuthProjection,
} from "./navigation-auth";

const PANEL_ID = "global-profile-menu";
const PANEL_MOTION_SAFETY_MS = 450;
type PanelPhase = "closed" | "opening" | "open" | "closing";
type NavigationView = "root" | "world" | "tools";

function prefersReducedMotion() {
	return (
		typeof window !== "undefined" &&
		window.matchMedia("(prefers-reduced-motion: reduce)").matches
	);
}

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

function NavigationLinks({
	items,
	pathname,
	onNavigate,
}: Readonly<{
	items: readonly NavigationItem[];
	pathname: string;
	onNavigate: () => void;
}>) {
	return (
		<ul className="account-menu-link-list">
			{items.map((item) => {
				const current = isCurrentNavigationPath(pathname, item.href);
				return (
					<li key={item.href}>
						<Link
							href={item.href}
							className="account-menu-nav-link"
							aria-current={current ? "page" : undefined}
							onClick={onNavigate}
						>
							<NavigationIconGlyph
								name={item.icon}
								className="account-menu-nav-icon"
							/>
							<span>{item.label}</span>
						</Link>
					</li>
				);
			})}
		</ul>
	);
}

export function AccountMenu() {
	const pathname = usePathname();
	const [phase, setPhase] = useState<PanelPhase>("closed");
	const [navigationView, setNavigationView] = useState<NavigationView>("root");
	const [projection, setProjection] = useState<NavigationAuthProjection | null>(
		null,
	);
	const [avatarFailed, setAvatarFailed] = useState(false);
	const [returnPath, setReturnPath] = useState(pathname || "/");
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const mounted = phase !== "closed";
	const expanded = phase === "opening" || phase === "open";

	const close = useCallback((restoreFocus = false) => {
		setNavigationView("root");
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
		if (phase === "closed" || phase === "closing") {
			setNavigationView("root");
			setPhase(prefersReducedMotion() ? "open" : "opening");
			return;
		}
		setPhase(prefersReducedMotion() ? "closed" : "closing");
	}, [phase]);

	const tools = useMemo(
		() => visibleToolNavigationItems(projection?.capabilities ?? []),
		[projection],
	);
	const worldCurrent =
		isCurrentNavigationPath(pathname, "/mundo") ||
		WORLD_NAV_ITEMS.some((item) => isCurrentNavigationPath(pathname, item.href));
	const toolsCurrent = tools.some((item) =>
		isCurrentNavigationPath(pathname, item.href),
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
		setAvatarFailed(false);
		setReturnPath(
			typeof window === "undefined"
				? pathname || "/"
				: `${window.location.pathname}${window.location.search}${window.location.hash}`,
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
	const displayName = authenticated
		? projection.identity?.displayName ?? null
		: null;
	const avatarUrl = authenticated ? projection.identity?.avatarUrl ?? null : null;
	const initials = navigationInitials(displayName);
	const showAvatar = Boolean(avatarUrl) && !avatarFailed;

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
					data-view={navigationView}
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
						{navigationView === "root" ? (
							<section aria-labelledby="global-menu-public-title">
								<h2 id="global-menu-public-title">Explorar</h2>
								<ul className="account-menu-link-list">
									{PRIMARY_PUBLIC_NAV_ITEMS.map((item) => {
										if (item.href === "/mundo") {
											return (
												<li key={item.href}>
													<button
														type="button"
														className="account-menu-group-entry"
														aria-current={worldCurrent ? "page" : undefined}
														onClick={() => setNavigationView("world")}
													>
														<NavigationIconGlyph
															name={item.icon}
															className="account-menu-nav-icon"
														/>
														<span>{item.label}</span>
														<span className="account-menu-chevron" aria-hidden="true">→</span>
													</button>
												</li>
											);
										}
										const current = isCurrentNavigationPath(pathname, item.href);
										return (
											<li key={item.href}>
												<Link
													href={item.href}
													className="account-menu-nav-link"
													aria-current={current ? "page" : undefined}
													onClick={closeAfterNavigate}
												>
													<NavigationIconGlyph
														name={item.icon}
														className="account-menu-nav-icon"
													/>
													<span>{item.label}</span>
												</Link>
											</li>
										);
									})}
								</ul>

								{tools.length > 0 ? (
									<button
										type="button"
										className="account-menu-group-entry account-menu-tools-entry"
										aria-current={toolsCurrent ? "page" : undefined}
										onClick={() => setNavigationView("tools")}
									>
										<NavigationIconGlyph
											name="process"
											className="account-menu-nav-icon"
										/>
										<span>Ferramentas</span>
										<span className="account-menu-chevron" aria-hidden="true">→</span>
									</button>
								) : null}
							</section>
						) : (
							<section
								aria-labelledby={
									navigationView === "world"
										? "global-menu-world-title"
										: "global-menu-tools-title"
								}
							>
								<div className="account-menu-view-header">
									<button
										type="button"
										className="account-menu-back"
										onClick={() => setNavigationView("root")}
									>
										<span aria-hidden="true">←</span>
										Voltar
									</button>
									<h2
										id={
											navigationView === "world"
												? "global-menu-world-title"
												: "global-menu-tools-title"
										}
									>
										{navigationView === "world" ? "Mundo" : "Ferramentas"}
									</h2>
								</div>

								{navigationView === "world" ? (
									<>
										<NavigationLinks
											items={[
												{ href: "/mundo", label: "Explorar tudo", icon: "world" },
												...WORLD_NAV_ITEMS,
											]}
											pathname={pathname}
											onNavigate={closeAfterNavigate}
										/>
									</>
								) : (
									<NavigationLinks
										items={tools}
										pathname={pathname}
										onNavigate={closeAfterNavigate}
									/>
								)}
							</section>
						)}
					</nav>

					<div className="account-menu-account-block">
						{projection === null ? (
							<p className="account-menu-status" role="status">
								Carregando conta…
							</p>
						) : projection.state === "unavailable" ? (
							<div className="account-menu-status" role="status">
								<strong>Conta temporariamente indisponível</strong>
								<span>
									Não foi possível verificar sua sessão agora. A navegação pública
									continua disponível.
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
				</section>
			) : null}
		</div>
	);
}
