"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
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
	const [open, setOpen] = useState(false);
	const [projection, setProjection] = useState<NavigationAuthProjection | null>(
		null,
	);
	const [avatarFailed, setAvatarFailed] = useState(false);
	const [returnPath, setReturnPath] = useState(pathname || "/");
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
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
		setOpen(false);
		setAvatarFailed(false);
		setReturnPath(
			typeof window === "undefined"
				? pathname || "/"
				: `${window.location.pathname}${window.location.search}${window.location.hash}`,
		);
	}, [pathname]);

	useEffect(() => {
		if (!open) return;

		const onPointerDown = (event: PointerEvent) => {
			if (
				event.target instanceof Node &&
				!rootRef.current?.contains(event.target)
			) {
				setOpen(false);
			}
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			setOpen(false);
			requestAnimationFrame(() => triggerRef.current?.focus());
		};

		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [open]);

	const authenticated =
		projection !== null && isAuthenticatedNavigationState(projection.state);
	const displayName = authenticated ? projection.identity?.displayName ?? null : null;
	const avatarUrl = authenticated ? projection.identity?.avatarUrl ?? null : null;
	const initials = navigationInitials(displayName);
	const showAvatar = Boolean(avatarUrl) && !avatarFailed;
	const close = () => setOpen(false);

	return (
		<div className="account-menu" ref={rootRef}>
			<button
				ref={triggerRef}
				type="button"
				className="account-menu-trigger"
				aria-label="Abrir menu global"
				aria-expanded={open}
				aria-controls={PANEL_ID}
				onClick={() => setOpen((value) => !value)}
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

			{open ? (
				<section
					className="account-menu-panel"
					id={PANEL_ID}
					aria-label="Navegação, conta e aparência"
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
								onClick={close}
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
								onNavigate={close}
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
									onNavigate={close}
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
