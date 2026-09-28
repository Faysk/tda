"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PublicLink as Link } from "./public-link";
import { PublicNav } from "./public-nav";
import { ThemeToggle } from "./theme-toggle";

const ACCOUNT_PANEL_ID = "global-account-panel";

type HeaderAuthState =
	| "loading"
	| "anonymous"
	| "authenticated_unlinked"
	| "authenticated_linked"
	| "authenticated_linked_no_grants"
	| "unavailable";

type HeaderIdentity = Readonly<{
	displayName: string | null;
	avatarUrl: string | null;
}>;

type HeaderAuth = Readonly<{
	state: HeaderAuthState;
	capabilities: readonly string[];
	identity: HeaderIdentity | null;
}>;

const INITIAL_AUTH: HeaderAuth = {
	state: "loading",
	capabilities: [],
	identity: null,
};

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function parseCapabilities(value: unknown): readonly string[] {
	if (!Array.isArray(value)) return [];
	return value.filter(
		(capability): capability is string =>
			typeof capability === "string" && capability.length > 0,
	);
}

function parseIdentity(value: unknown): HeaderIdentity | null {
	const identity = record(value);
	if (!identity) return null;
	return {
		displayName:
			typeof identity.displayName === "string" ? identity.displayName : null,
		avatarUrl: typeof identity.avatarUrl === "string" ? identity.avatarUrl : null,
	};
}

function parseHeaderAuth(payload: unknown): HeaderAuth {
	const body = record(payload);
	if (!body) return { ...INITIAL_AUTH, state: "unavailable" };

	switch (body.state) {
		case "anonymous":
			return { state: "anonymous", capabilities: [], identity: null };
		case "unavailable":
			return { state: "unavailable", capabilities: [], identity: null };
		case "authenticated_unlinked":
		case "authenticated_linked":
		case "authenticated_linked_no_grants":
			return {
				state: body.state,
				capabilities: parseCapabilities(body.capabilities),
				identity: parseIdentity(body.identity),
			};
		default:
			return { state: "unavailable", capabilities: [], identity: null };
	}
}

function isAuthenticated(state: HeaderAuthState): boolean {
	return state.startsWith("authenticated_");
}

function initialsFor(displayName: string | null): string | null {
	if (!displayName) return null;
	const parts = displayName.trim().split(/\s+/u).filter(Boolean);
	if (parts.length === 0) return null;
	const selected =
		parts.length === 1 ? [parts[0]] : [parts[0], parts[parts.length - 1]];
	const initials = selected
		.map((part) => Array.from(part)[0] ?? "")
		.join("")
		.toLocaleUpperCase("pt-BR");
	return Array.from(initials).slice(0, 2).join("") || null;
}

function AccountFallbackIcon() {
	return (
		<svg
			className="account-avatar-icon"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.65"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<circle cx="12" cy="8" r="3.25" />
			<path d="M5 20c.9-4.3 3.2-6.4 7-6.4s6.1 2.1 7 6.4" />
		</svg>
	);
}

function AccountMenu({ auth }: Readonly<{ auth: HeaderAuth }>) {
	const pathname = usePathname();
	const [open, setOpen] = useState(false);
	const [imageFailed, setImageFailed] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const authenticated = isAuthenticated(auth.state);
	const displayName = authenticated ? auth.identity?.displayName ?? null : null;
	const avatarUrl = authenticated ? auth.identity?.avatarUrl ?? null : null;
	const initials = initialsFor(displayName);
	const loginHref = `/entrar?next=${encodeURIComponent(pathname)}`;

	useEffect(() => {
		setImageFailed(false);
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

	const close = () => setOpen(false);

	return (
		<div className="account-menu" ref={rootRef}>
			<button
				ref={triggerRef}
				type="button"
				className="account-menu-trigger"
				aria-label="Abrir menu da conta"
				aria-expanded={open}
				aria-controls={ACCOUNT_PANEL_ID}
				data-auth-state={auth.state}
				onClick={() => setOpen((value) => !value)}
			>
				<span className="account-avatar" aria-hidden="true">
					{avatarUrl && !imageFailed ? (
						<img
							className="account-avatar-image"
							src={avatarUrl}
							alt=""
							onError={() => setImageFailed(true)}
						/>
					) : initials ? (
						<span className="account-avatar-initials">{initials}</span>
					) : (
						<AccountFallbackIcon />
					)}
				</span>
			</button>

			{open ? (
				<div className="account-menu-panel" id={ACCOUNT_PANEL_ID}>
					{auth.state === "loading" ? (
						<div className="account-menu-status" role="status">
							<strong>Carregando sua conta…</strong>
							<span>A navegação pública continua disponível.</span>
						</div>
					) : null}

					{auth.state === "unavailable" ? (
						<div className="account-menu-status" role="status">
							<strong>Conta temporariamente indisponível</strong>
							<span>
								Não foi possível consultar seu estado de acesso agora. Tente
								novamente em instantes.
							</span>
						</div>
					) : null}

					{auth.state === "anonymous" ? (
						<Link
							className="account-menu-action account-menu-action--primary"
							href={loginHref}
							onClick={close}
						>
							Entrar com Discord
						</Link>
					) : null}

					{authenticated ? (
						<>
							<div className="account-menu-identity">
								<strong>Sua conta</strong>
								<span>{displayName ?? "Conta conectada"}</span>
							</div>
							<Link
								className="account-menu-action"
								href="/conta"
								onClick={close}
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
					) : null}

					<div className="account-menu-appearance">
						<span>Aparência</span>
						<ThemeToggle />
					</div>
				</div>
			) : null}
		</div>
	);
}

export function HeaderControls() {
	const [auth, setAuth] = useState<HeaderAuth>(INITIAL_AUTH);

	useEffect(() => {
		const controller = new AbortController();
		void fetch("/api/auth/me", {
			cache: "no-store",
			signal: controller.signal,
		})
			.then(async (response) => {
				const payload = await response.json().catch(() => null);
				return parseHeaderAuth(payload);
			})
			.then((nextAuth) => {
				if (!controller.signal.aborted) setAuth(nextAuth);
			})
			.catch(() => {
				if (!controller.signal.aborted) {
					setAuth({ state: "unavailable", capabilities: [], identity: null });
				}
			});
		return () => controller.abort();
	}, []);

	return (
		<>
			<PublicNav capabilities={auth.capabilities} />
			<AccountMenu auth={auth} />
		</>
	);
}
