"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PublicLink as Link } from "./public-link";
import { NavigationList } from "./public-nav";
import {
	PUBLIC_NAV_ITEMS,
	visibleToolNavigationItems,
} from "./public-navigation-model";
import { ThemeToggle } from "./theme-toggle";
import {
	isAuthenticatedNavigationState,
	loadNavigationAuthProjection,
	navigationInitials,
	type NavigationAuthProjection,
} from "./navigation-auth";

const PANEL_ID = "global-profile-menu";
const PANEL_MOTION_SAFETY_MS = 2_250;
type PanelPhase = "closed" | "opening" | "open" | "closing";

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

export function AccountMenu() {
	const pathname = usePathname();
	const [phase, setPhase] = useState<PanelPhase>("closed");
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
		setPhase((current) => {
			if (current === "closed" || current === "closing") {
				return prefersReducedMotion() ? "open" : "opening";
			}
			return prefersReducedMotion() ? "closed" : "closing";
		});
	}, []);
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
	const displayName = authenticated ? projection.identity?.displayName ?? null : null;
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

					<nav className="account-menu-navigation" aria-label="Navegação principal">
						<section aria-labelledby="global-menu-public-title">
							<h2 id="global-menu-public-title">Explorar</h2>
							<NavigationList
								items={PUBLIC_NAV_ITEMS}
								pathname={pathname}
								onNavigate={closeAfterNavigate}
							/>
						</section>

						{tools.length > 0 ? (
							<section
								className="product-launcher-tools"
								aria-labelledby="global-menu-tools-title"
							>
								<h2 id="global-menu-tools-title">Ferramentas</h2>
								<NavigationList
									items={tools}
									pathname={pathname}
									onNavigate={closeAfterNavigate}
								/>
							</section>
						) : null}
					</nav>

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
