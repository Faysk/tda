export type NavigationAuthState =
	| "anonymous"
	| "unavailable"
	| "authenticated_unlinked"
	| "authenticated_linked"
	| "authenticated_linked_no_grants";

export type NavigationIdentity = Readonly<{
	displayName: string | null;
	avatarUrl: string | null;
}>;

export type NavigationAuthProjection = Readonly<{
	state: NavigationAuthState;
	identity: NavigationIdentity | null;
	capabilities: readonly string[];
}>;

const UNAVAILABLE_PROJECTION: NavigationAuthProjection = {
	state: "unavailable",
	identity: null,
	capabilities: [],
};

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

function parseState(value: unknown): NavigationAuthState | null {
	switch (value) {
		case "anonymous":
		case "unavailable":
		case "authenticated_unlinked":
		case "authenticated_linked":
		case "authenticated_linked_no_grants":
			return value;
		default:
			return null;
	}
}

function parseIdentity(value: unknown): NavigationIdentity | null {
	const input = record(value);
	if (!input) return null;
	return {
		displayName:
			typeof input.displayName === "string" && input.displayName.length > 0
				? input.displayName
				: null,
		avatarUrl:
			typeof input.avatarUrl === "string" && input.avatarUrl.length > 0
				? input.avatarUrl
				: null,
	};
}

function parseCapabilities(value: unknown): readonly string[] {
	if (!Array.isArray(value)) return [];
	return value.filter(
		(capability): capability is string =>
			typeof capability === "string" && capability.length > 0,
	);
}

export function isAuthenticatedNavigationState(
	state: NavigationAuthState,
): boolean {
	return AUTHENTICATED_STATES.has(state);
}

export function parseNavigationAuthProjection(
	value: unknown,
): NavigationAuthProjection {
	const input = record(value);
	const state = parseState(input?.state);
	if (!input || !state) return UNAVAILABLE_PROJECTION;

	if (!isAuthenticatedNavigationState(state)) {
		return {
			state,
			identity: null,
			capabilities: [],
		};
	}

	return {
		state,
		identity: parseIdentity(input.identity),
		capabilities: parseCapabilities(input.capabilities),
	};
}

export function navigationInitials(displayName: string | null): string | null {
	if (!displayName) return null;
	const parts = displayName.trim().split(/\s+/u).filter(Boolean);
	if (parts.length === 0) return null;
	const selected =
		parts.length === 1 ? [parts[0]] : [parts[0], parts.at(-1) ?? ""];
	const initials = selected
		.map((part) => Array.from(part)[0] ?? "")
		.join("")
		.toLocaleUpperCase("pt-BR");
	return initials || null;
}

let projectionRequest: Promise<NavigationAuthProjection> | null = null;

export function loadNavigationAuthProjection(): Promise<NavigationAuthProjection> {
	if (projectionRequest) return projectionRequest;

	projectionRequest = fetch("/api/auth/me", { cache: "no-store" })
		.then(async (response) => {
			let payload: unknown = null;
			try {
				payload = await response.json();
			} catch {
				return UNAVAILABLE_PROJECTION;
			}

			const projection = parseNavigationAuthProjection(payload);
			if (response.ok) return projection;
			if (response.status === 503 && projection.state === "unavailable")
				return projection;
			return UNAVAILABLE_PROJECTION;
		})
		.catch(() => UNAVAILABLE_PROJECTION);

	return projectionRequest;
}
