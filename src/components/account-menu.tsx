"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PublicLink as Link } from "./public-link";
import { ThemeToggle } from "./theme-toggle";
import {
	isAuthenticatedNavigationState,
	useNavigationAuth,
} from "./navigation-auth";

const PANEL_ID = "global-account-panel";

function initials(displayName: string | null): string | null {
	if (!displayName) return null;
	const parts = displayName.trim().split(/\s+/u).filter(Boolean);
	if (parts.length === 0) return null;
	const selected = parts.length === 1 ? parts : [parts[0], parts.at(-1) ?? ""];
	const value = selected
		.map((part) => Array.from(part)[0] ?? "")
		.join("")
		.toLocaleUpperCase("pt-BR");
	return value || null;
}

function GenericAvatar() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<circle cx="12" cy="8" r="3.25" />
			<path d="M5.5 20c.8-4.25 3-6.25 6.5-6.25S17.7 15.75 18.5 20" />
		</svg>
	);
}

export function AccountMenu() {
	const pathname = usePathname();
	const { state, identity } = useNavigationAuth();
	const [open, setOpen] = useState(false);
	const [avatarFailed, setAvatarFailed] = useState(false);
	const [returnPath, setReturnPath] = useState(pathname || "/");
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const authenticated = isAuthenticatedNavigationState(state);
	const avatarUrl = authenticated ? identity?.avatarUrl ?? null : null;
	const avatarInitials = authenticated
		? initials(identity?.displayName ?? null)
		: null;

	useEffect(() => {
		setAvatarFailed(false);
	}, [avatarUrl]);

	useEffect(() => {
		setReturnPath(
			`${window.location.pathname}${window.location.search}${window.location.hash}` ||
				"/",
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

	const close = () => setOpen(false);
	const showImage = Boolean(avatarUrl && !avatarFailed);

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
				<span className="account-avatar" aria-hidden="true">
					{showImage ? (
						<img
							src={avatarUrl ?? ""}
							alt=""
							referrerPolicy="no-referrer"
							onError={() => setAvatarFailed(true)}
						/>
					) : avatarInitials ? (
						<span className="account-avatar-initials">{avatarInitials}</span>
					) : (
						<GenericAvatar />
					)}
				</span>
			</button>

			{open ? (
				<div className="account-menu-panel" id={PANEL_ID}>
					<div className="account-menu-identity" aria-live="polite">
						{authenticated ? (
							<>
								<span className="account-menu-kicker">Sua conta</span>
								<strong>{identity?.displayName ?? "Conta do Discord"}</strong>
							</>
						) : state === "unavailable" ? (
							<>
								<span className="account-menu-kicker">Sua conta</span>
								<strong>Verificação indisponível</strong>
								<small>
									Não foi possível confirmar sua sessão agora. A navegação
									pública continua disponível.
								</small>
							</>
						) : state === "loading" ? (
							<>
								<span className="account-menu-kicker">Sua conta</span>
								<strong>Verificando conta…</strong>
							</>
						) : (
							<>
								<span className="account-menu-kicker">Sua conta</span>
								<strong>Visitante</strong>
							</>
						)}
					</div>

					<div className="account-menu-actions">
						{authenticated ? (
							<Link
								href="/conta"
								className="account-menu-link"
								onClick={close}
							>
								Conta e acesso
							</Link>
						) : state === "anonymous" ? (
							<form
								action="/auth/discord"
								method="post"
								className="account-menu-form"
								onSubmit={close}
							>
								<input type="hidden" name="next" value={returnPath} />
								<button type="submit" className="account-menu-primary">
									Entrar com Discord
								</button>
							</form>
						) : state === "unavailable" ? (
							<Link
								href="/conta?acesso=indisponivel"
								className="account-menu-link"
								onClick={close}
							>
								Conta e acesso
							</Link>
						) : null}

						<div className="account-menu-appearance">
							<div>
								<span>Aparência</span>
								<small>Alternar tema claro e escuro</small>
							</div>
							<ThemeToggle />
						</div>

						{authenticated ? (
							<form
								action="/auth/logout"
								method="post"
								className="account-menu-form"
								onSubmit={close}
							>
								<button type="submit" className="account-menu-logout">
									Sair
								</button>
							</form>
						) : null}
					</div>
				</div>
			) : null}
		</div>
	);
}
