"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PublicLink as Link } from "./public-link";
import { PublicNav } from "./public-nav";
import { ThemeToggle } from "./theme-toggle";

const ACCOUNT_PANEL_ID = "global-account-menu";
const DISCORD_AVATAR_HOST = "cdn.discordapp.com";
const DISCORD_AVATAR_PATHS = ["/avatars/", "/embed/avatars/"] as const;

type NavigationAuthState =
	| "loading"
	| "anonymous"
	| "unavailable"
	| "authenticated_unlinked"
	| "authenticated_linked_no_grants"
	| "authenticated_linked";

type NavigationIdentity = Readonly<{
	displayName: string | null;
	avatarUrl: string | null;
}>;

type NavigationProjection = Readonly<{
	state: NavigationAuthState;
	capabilities: readonly string[];
	identity: NavigationIdentity | null;
}>;

const INITIAL_PROJECTION: NavigationProjection = {
	state: "loading",
	capabilities: [],
	identity: null,
};

function objectRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function isAuthenticatedState(
	state: NavigationAuthState,
): state is
	| "authenticated_unlinked"
	| "authenticated_linked_no_grants"
	| "authenticated_linked" {
	return state.startsWith("authenticated_");
}

function parseAvatarUrl(value: unknown): string | null {
	if (typeof value !== "string") return null;
	try {
		const url = new URL(value);
		if (
			url.protocol !== "https:" ||
			url.hostname !== DISCORD_AVATAR_HOST ||
			url.port ||
			url.username ||
			url.password ||
			!DISCORD_AVATAR_PATHS.some((prefix) => url.pathname.startsWith(prefix))
		) {
			return null;
		}
		url.search = "";
		url.hash = "";
		return url.toString();
	} catch {
		return null;
	}
}

function parseIdentity(value: unknown): NavigationIdentity {
	const identity = objectRecord(value);
	const displayName =
		typeof identity?.displayName === "string"
			? Array.from(identity.displayName.trim()).slice(0, 80).join("") || null
			: null;
	return {
		displayName,
		avatarUrl: parseAvatarUrl(identity?.avatarUrl),
	};
}

function parseProjection(payload: unknown, responseOk: boolean): NavigationProjection {
	if (!responseOk) {
		return { state: "unavailable", capabilities: [], identity: null };
	}

	const record = objectRecord(payload);
	const rawState = record?.state;
	const state =
		rawState === "anonymous" ||
		rawState === "unavailable" ||
		rawState === "authenticated_unlinked" ||
		rawState === "authenticated_linked_no_grants" ||
		rawState === "authenticated_linked"
			? rawState
			: "unavailable";

	if (!isAuthenticatedState(state)) {
		return { state, capabilities: [], identity: null };
	}

	const capabilities = Array.isArray(record?.capabilities)
		? record.capabilities.filter(
				(value): value is string =>
					typeof value === "string" && value.length > 0 && value.length <= 160,
			)
		: [];

	return {
		state,
		capabilities,
		identity: parseIdentity(record?.identity),
	};
}

function initialsFor(displayName: string | null): string | null {
	if (!displayName) return null;
	const tokens = displayName.split(/\s+/u).filter(Boolean);
	if (tokens.length === 0) return null;
	const first = Array.from(tokens[0] ?? "")[0] ?? "";
	const second =
		tokens.length > 1 ? (Array.from(tokens[tokens.length - 1] ?? "")[0] ?? "") : "";
	return `${first}${second}`.toLocaleUpperCase("pt-BR") || null;
}

function AccountAvatar({
	identity,
	authenticated,
}: Readonly<{
	identity: NavigationIdentity | null;
	authenticated: boolean;
}>) {
	const avatarUrl = authenticated ? identity?.avatarUrl ?? null : null;
	const initials = authenticated ? initialsFor(identity?.displayName ?? null) : null;
	const [avatarFailed, setAvatarFailed] = useState(false);

	useEffect(() => {
		setAvatarFailed(false);
	}, [avatarUrl]);

	if (avatarUrl && !avatarFailed) {
		return (
			<img
				className="account-menu-avatar-image"
				src={avatarUrl}
				alt=""
				referrerPolicy="no-referrer"
				onError={() => setAvatarFailed(true)}
			/>
		);
	}

	return (
		<span className="account-menu-avatar-fallback" aria-hidden="true">
			{initials ?? (
				<svg viewBox="0 0 24 24">
					<circle cx="12" cy="8" r="3.25" />
					<path d="M5.5 20c.8-4.2 3-6.25 6.5-6.25S17.7 15.8 18.5 20" />
				</svg>
			)}
		</span>
	);
}

function AccountMenu({
	projection,
}: Readonly<{
	projection: NavigationProjection;
}>) {
	const pathname = usePathname();
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const authenticated = isAuthenticatedState(projection.state);

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
	const loginHref = `/entrar?next=${encodeURIComponent(pathname || "/")}`;

	return (
		<div className="account-menu" ref={rootRef}>
			<button
				ref={triggerRef}
				type="button"
				className="account-menu-trigger"
				aria-label="Abrir menu da conta"
				aria-expanded={open}
				aria-controls={ACCOUNT_PANEL_ID}
				onClick={() => setOpen((value) => !value)}
			>
				<AccountAvatar
					identity={projection.identity}
					authenticated={authenticated}
				/>
			</button>

			{open ? (
				<div className="account-menu-panel" id={ACCOUNT_PANEL_ID}>
					{authenticated ? (
						<div className="account-menu-identity">
							<strong>{projection.identity?.displayName ?? "Conta Discord"}</strong>
							<span>Conectado com Discord</span>
						</div>
					) : projection.state === "unavailable" ? (
						<p className="account-menu-status" role="status">
							Não foi possível verificar sua conta agora. A navegação pública
							continua disponível.
						</p>
					) : projection.state === "loading" ? (
						<p className="account-menu-status" role="status">
							Verificando sua conta…
						</p>
					) : null}

					<div className="account-menu-actions">
						{projection.state === "anonymous" ? (
							<Link
								href={loginHref}
								className="account-menu-action"
								onClick={close}
							>
								Entrar com Discord
							</Link>
						) : null}

						{authenticated ? (
							<Link
								href="/conta"
								className="account-menu-action"
								onClick={close}
							>
								Conta e acesso
							</Link>
						) : null}

						{projection.state === "unavailable" ? (
							<Link
								href="/conta?acesso=indisponivel"
								className="account-menu-action"
								onClick={close}
							>
								Conta e acesso
							</Link>
						) : null}
					</div>

					<div className="account-menu-appearance">
						<span>Aparência</span>
						<ThemeToggle />
					</div>

					{authenticated ? (
						<form
							className="account-menu-logout"
							action="/auth/logout"
							method="post"
						>
							<button type="submit" className="account-menu-action">
								Sair
							</button>
						</form>
					) : null}
				</div>
			) : null}
		</div>
	);
}

export function GlobalNavigationActions() {
	const [projection, setProjection] =
		useState<NavigationProjection>(INITIAL_PROJECTION);

	useEffect(() => {
		const controller = new AbortController();
		void fetch("/api/auth/me", {
			cache: "no-store",
			signal: controller.signal,
		})
			.then(async (response) => {
				let payload: unknown = null;
				try {
					payload = await response.json();
				} catch {
					// Invalid private projection is treated as unavailable.
				}
				return parseProjection(payload, response.ok);
			})
			.then((nextProjection) => {
				if (!controller.signal.aborted) setProjection(nextProjection);
			})
			.catch(() => {
				if (!controller.signal.aborted) {
					setProjection({
						state: "unavailable",
						capabilities: [],
						identity: null,
					});
				}
			});
		return () => controller.abort();
	}, []);

	return (
		<>
			<PublicNav capabilities={projection.capabilities} />
			<AccountMenu projection={projection} />
		</>
	);
}
