"use client";

export type NavigationAuthState =
	| "anonymous"
	| "authenticated_unlinked"
	| "authenticated_linked"
	| "authenticated_linked_no_grants"
	| "unavailable";

export type NavigationIdentityProjection = Readonly<{
	displayName: string | null;
	avatarUrl: string | null;
}>;

export type NavigationAuthProjection = Readonly<{
	state: NavigationAuthState;
	capabilities: readonly string[];
	identity: NavigationIdentityProjection | null;
}>;

const AUTHENTICATED_STATES = new Set<NavigationAuthState>([
	"authenticated_unlinked",
	"authenticated_linked",
	"authenticated_linked_no_grants",
]);

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function nullableString(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function parseCapabilities(value: unknown): readonly string[] {
	if (!Array.isArray(value)) return [];
	return value.filter(
		(capability): capability is string =>
			typeof capability === "string" && capability.length > 0,
	);
}

function parseState(value: unknown): NavigationAuthState {
	switch (value) {
		case "authenticated_unlinked":
		case "authenticated_linked":
		case "authenticated_linked_no_grants":
		case "unavailable":
			return value;
		default:
			return "anonymous";
	}
}

export function isAuthenticatedNavigationState(
	state: NavigationAuthState,
): boolean {
	return AUTHENTICATED_STATES.has(state);
}

export function parseNavigationAuthProjection(
	payload: unknown,
): NavigationAuthProjection {
	const source = record(payload);
	const state = parseState(source?.state);
	if (!source || !isAuthenticatedNavigationState(state)) {
		return { state, capabilities: [], identity: null };
	}

	const identity = record(source.identity);
	return {
		state,
		capabilities: parseCapabilities(source.capabilities),
		identity: identity
			? {
					displayName: nullableString(identity.displayName),
					avatarUrl: nullableString(identity.avatarUrl),
				}
			: { displayName: null, avatarUrl: null },
	};
}

let navigationAuthRequest: Promise<NavigationAuthProjection> | null = null;

export function loadNavigationAuthProjection(): Promise<NavigationAuthProjection> {
	if (!navigationAuthRequest) {
		navigationAuthRequest = fetch("/api/auth/me", { cache: "no-store" })
			.then(async (response) =>
				parseNavigationAuthProjection(await response.json()),
			)
			.catch(() => ({
				state: "unavailable" as const,
				capabilities: [],
				identity: null,
			}));
	}
	return navigationAuthRequest;
}
