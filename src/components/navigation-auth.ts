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

export type NavigationCampaignState =
	| "none"
	| "first_class"
	| "legacy_compatibility"
	| "unavailable";

export type NavigationCampaignProjection = Readonly<{
	technicalSlug: string;
	routeKey: string | null;
	name: string;
	lifecycle: "active" | "archived";
	capabilities: readonly string[];
}>;

export type NavigationAuthProjection = Readonly<{
	state: NavigationAuthState;
	identity: NavigationIdentity | null;
	capabilities: readonly string[];
	campaignsState: NavigationCampaignState;
	campaigns: readonly NavigationCampaignProjection[];
}>;

const UNAVAILABLE_PROJECTION: NavigationAuthProjection = {
	state: "unavailable",
	identity: null,
	capabilities: [],
	campaignsState: "unavailable",
	campaigns: [],
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

function parseCampaignsState(value: unknown): NavigationCampaignState | null {
	switch (value) {
		case "none":
		case "first_class":
		case "legacy_compatibility":
		case "unavailable":
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

function parseCampaigns(
	value: unknown,
): readonly NavigationCampaignProjection[] | null {
	if (!Array.isArray(value)) return null;
	const campaigns: NavigationCampaignProjection[] = [];
	for (const raw of value) {
		const input = record(raw);
		if (!input) return null;
		const technicalSlug =
			typeof input.technicalSlug === "string" && input.technicalSlug.length > 0
				? input.technicalSlug
				: null;
		const name =
			typeof input.name === "string" && input.name.length > 0
				? input.name
				: null;
		const lifecycle =
			input.lifecycle === "active" || input.lifecycle === "archived"
				? input.lifecycle
				: null;
		const routeKey =
			typeof input.routeKey === "string" && input.routeKey.length > 0
				? input.routeKey
				: null;
		if (!technicalSlug || !name || !lifecycle) return null;
		campaigns.push({
			technicalSlug,
			routeKey,
			name,
			lifecycle,
			capabilities: parseCapabilities(input.capabilities),
		});
	}
	return campaigns;
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
			campaignsState: state === "unavailable" ? "unavailable" : "none",
			campaigns: [],
		};
	}

	const campaignsState = parseCampaignsState(input.campaignsState);
	const campaigns = parseCampaigns(input.campaigns);
	if (!campaignsState || !campaigns || campaignsState === "unavailable") {
		return {
			state,
			identity: parseIdentity(input.identity),
			capabilities: parseCapabilities(input.capabilities),
			campaignsState: "unavailable",
			campaigns: [],
		};
	}

	return {
		state,
		identity: parseIdentity(input.identity),
		capabilities: parseCapabilities(input.capabilities),
		campaignsState,
		campaigns,
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
