import type { NavigationAuthState } from "./navigation-auth";

export function accountInitials(displayName: string | null): string | null {
	if (!displayName) return null;
	const words = displayName.trim().split(/\s+/u).filter(Boolean);
	if (words.length === 0) return null;
	const first = Array.from(words[0] ?? "")[0] ?? "";
	const last =
		words.length > 1
			? (Array.from(words[words.length - 1] ?? "")[0] ?? "")
			: (Array.from(words[0] ?? "")[1] ?? "");
	const initials = `${first}${last}`.toLocaleUpperCase("pt-BR");
	return initials || null;
}

export function loginHrefForPath(pathname: string): string {
	const safePath =
		pathname.startsWith("/") && !pathname.startsWith("//") ? pathname : "/";
	return `/entrar?next=${encodeURIComponent(safePath)}`;
}

export function isAuthenticatedAccountState(
	state: NavigationAuthState | undefined,
): boolean {
	return (
		state === "authenticated_unlinked" ||
		state === "authenticated_linked" ||
		state === "authenticated_linked_no_grants"
	);
}
