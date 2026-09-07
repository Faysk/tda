import { createServerClient, type CookieMethodsServer } from "@supabase/ssr";
import { AUTH_COOKIE, authConfig } from "./config";

export function authClient(cookies: CookieMethodsServer) {
	const config = authConfig();
	if (!config) return null;
	return createServerClient(config.url, config.key, {
		cookieOptions: {
			name: AUTH_COOKIE,
			httpOnly: true,
			secure: config.secure,
			sameSite: "lax",
			path: "/",
		},
		cookies,
		global: {
			fetch: (input, init) =>
				fetch(input, {
					...init,
					cache: "no-store",
					signal: AbortSignal.timeout(10000),
				}),
		},
	});
}
