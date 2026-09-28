"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ThemeToggle } from "./theme-toggle";
import { PublicLink as Link } from "./public-link";
import {
	accountInitials,
	isAuthenticatedAccountState,
	loginHrefForPath,
} from "./account-menu-model";
import {
	loadNavigationAuthProjection,
	type NavigationAuthProjection,
} from "./navigation-auth";

const PANEL_ID = "global-account-panel";

function PersonGlyph() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<circle cx="12" cy="8" r="3.25" />
			<path d="M5.5 20c.8-4.1 3-6.1 6.5-6.1s5.7 2 6.5 6.1" />
		</svg>
	);
}

function AccountAvatar({
	displayName,
	avatarUrl,
	failed,
	onError,
	compact = false,
}: Readonly<{
	displayName: string | null;
	avatarUrl: string | null;
	failed: boolean;
	onError: () => void;
	compact?: boolean;
}>) {
	const initials = accountInitials(displayName);
	return (
		<span
			className={
				compact
					? "account-menu-avatar account-menu-avatar--compact"
					: "account-menu-avatar"
			}
			aria-hidden="true"
		>
			{avatarUrl && !failed ? (
				<img
					className="account-menu-avatar-image"
					src={avatarUrl}
					alt=""
					referrerPolicy="no-referrer"
					onError={onError}
				/>
			) : initials ? (
				<span className="account-menu-avatar-fallback">{initials}</span>
			) : (
				<PersonGlyph />
			)}
		</span>
	);
}

export function AccountMenu() {
	const pathname = usePathname();
	const [open, setOpen] = useState(false);
	const [projection, setProjection] =
		useState<NavigationAuthProjection | null>(null);
	const [avatarFailed, setAvatarFailed] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		let active = true;
		void loadNavigationAuthProjection().then((next) => {
			if (active) setProjection(next);
		});
		return () => {
			active = false;
		};
	}, []);

	const avatarUrl = projection?.identity?.avatarUrl ?? null;
	useEffect(() => {
		setAvatarFailed(false);
	}, [avatarUrl]);

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

	const state = projection?.state;
	const authenticated = isAuthenticatedAccountState(state);
	const unavailable = state === "unavailable";
	const displayName = authenticated
		? (projection?.identity?.displayName ?? null)
		: null;
	const loginHref = loginHrefForPath(pathname);

	return (
		<div className="account-menu" ref={rootRef}>
			<button
				ref={triggerRef}
				type="button"
				className="account-menu-trigger"
				aria-label="Abrir menu da conta"
				aria-expanded={open}
				aria-controls={PANEL_ID}
				onClick={() => setOpen((value) => !value)}
			>
				<AccountAvatar
					displayName={displayName}
					avatarUrl={authenticated ? avatarUrl : null}
					failed={avatarFailed}
					onError={() => setAvatarFailed(true)}
					compact
				/>
			</button>

			{open ? (
				<section
					className="account-menu-panel"
					id={PANEL_ID}
					aria-label="Conta e aparência"
				>
					<div className="account-menu-summary">
						<AccountAvatar
							displayName={displayName}
							avatarUrl={authenticated ? avatarUrl : null}
							failed={avatarFailed}
							onError={() => setAvatarFailed(true)}
						/>
						<div>
							<strong>
								{authenticated
									? displayName || "Conta TDA"
									: unavailable
										? "Conta indisponível"
										: projection
											? "Sua conta"
											: "Verificando conta"}
							</strong>
							<span>
								{authenticated
									? "Conectada pelo Discord"
									: unavailable
										? "Não foi possível verificar sua sessão agora."
										: projection
											? "Entre com Discord para acessar seus espaços."
											: "Consultando o estado da sessão…"}
							</span>
						</div>
					</div>

					<div className="account-menu-actions">
						{authenticated ? (
							<>
								<Link
									className="account-menu-action"
									href="/conta"
									onClick={() => setOpen(false)}
								>
									Conta e acesso
								</Link>
								<form action="/auth/logout" method="post">
									<button
										className="account-menu-action account-menu-action--button"
										type="submit"
									>
										Sair
									</button>
								</form>
							</>
						) : unavailable ? (
							<Link
								className="account-menu-action"
								href="/conta?acesso=indisponivel"
								onClick={() => setOpen(false)}
							>
								Ver estado do acesso
							</Link>
						) : projection ? (
							<Link
								className="account-menu-action account-menu-action--primary"
								href={loginHref}
								onClick={() => setOpen(false)}
							>
								Entrar com Discord
							</Link>
						) : null}
					</div>

					<div className="account-menu-appearance">
						<div>
							<strong>Aparência</strong>
							<span>Claro ou escuro</span>
						</div>
						<ThemeToggle />
					</div>
				</section>
			) : null}
		</div>
	);
}
