"use client";

import {
	createContext,
	useContext,
	useEffect,
	useMemo,
	useState,
	type ReactNode,
} from "react";

export type NavigationAuthState =
	| "loading"
	| "anonymous"
	| "unavailable"
	| "authenticated_unlinked"
	| "authenticated_linked"
	| "authenticated_linked_no_grants";

export type NavigationIdentity = Readonly<{
	displayName: string | null;
	avatarUrl: string | null;
}>;

type NavigationAuthValue = Readonly<{
	state: NavigationAuthState;
	identity: NavigationIdentity | null;
	capabilities: readonly string[];
}>;

const INITIAL_VALUE: NavigationAuthValue = {
	state: "loading",
	identity: null,
	capabilities: [],
};

const NavigationAuthContext = createContext<NavigationAuthValue | null>(null);

const AUTHENTICATED_STATES = new Set<NavigationAuthState>([
	"authenticated_unlinked",
	"authenticated_linked",
	"authenticated_linked_no_grants",
]);

function isNavigationAuthState(value: unknown): value is Exclude<
	NavigationAuthState,
	"loading"
> {
	return (
		value === "anonymous" ||
		value === "unavailable" ||
		value === "authenticated_unlinked" ||
		value === "authenticated_linked" ||
		value === "authenticated_linked_no_grants"
	);
}

function parseCapabilities(value: unknown): readonly string[] {
	if (!Array.isArray(value)) return [];
	return value.filter(
		(capability): capability is string =>
			typeof capability === "string" && capability.length > 0,
	);
}

function parseIdentity(value: unknown): NavigationIdentity {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return { displayName: null, avatarUrl: null };
	}
	const record = value as Record<string, unknown>;
	return {
		displayName:
			typeof record.displayName === "string" ? record.displayName : null,
		avatarUrl: typeof record.avatarUrl === "string" ? record.avatarUrl : null,
	};
}

function parseProjection(payload: unknown): NavigationAuthValue {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return { ...INITIAL_VALUE, state: "unavailable" };
	}
	const record = payload as Record<string, unknown>;
	if (!isNavigationAuthState(record.state)) {
		return { ...INITIAL_VALUE, state: "unavailable" };
	}
	if (!AUTHENTICATED_STATES.has(record.state)) {
		return {
			state: record.state,
			identity: null,
			capabilities: [],
		};
	}
	return {
		state: record.state,
		identity: parseIdentity(record.identity),
		capabilities: parseCapabilities(record.capabilities),
	};
}

export function NavigationAuthProvider({
	children,
}: Readonly<{ children: ReactNode }>) {
	const [projection, setProjection] =
		useState<NavigationAuthValue>(INITIAL_VALUE);

	useEffect(() => {
		const controller = new AbortController();
		void fetch("/api/auth/me", {
			cache: "no-store",
			signal: controller.signal,
		})
			.then(async (response) => {
				if (response.status === 503)
					return { ...INITIAL_VALUE, state: "unavailable" } as const;
				if (!response.ok)
					return { ...INITIAL_VALUE, state: "unavailable" } as const;
				try {
					return parseProjection(await response.json());
				} catch {
					return { ...INITIAL_VALUE, state: "unavailable" } as const;
				}
			})
			.then((nextProjection) => {
				if (!controller.signal.aborted) setProjection(nextProjection);
			})
			.catch(() => {
				if (!controller.signal.aborted)
					setProjection({ ...INITIAL_VALUE, state: "unavailable" });
			});
		return () => controller.abort();
	}, []);

	const value = useMemo(
		() => projection,
		[projection],
	);

	return (
		<NavigationAuthContext.Provider value={value}>
			{children}
		</NavigationAuthContext.Provider>
	);
}

export function useNavigationAuth(): NavigationAuthValue {
	const value = useContext(NavigationAuthContext);
	if (!value)
		throw new Error(
			"useNavigationAuth must be used inside NavigationAuthProvider.",
		);
	return value;
}

export function isAuthenticatedNavigationState(
	state: NavigationAuthState,
): boolean {
	return AUTHENTICATED_STATES.has(state);
}
