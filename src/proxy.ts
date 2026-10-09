import { NextResponse, type NextRequest } from "next/server";
import { authClient } from "./features/auth/client";

const protectedAuthRoutes = new RegExp("^(?:/(?:edit|transcricoes|conta|entrar)(?:/|$)|/api/auth(?:/|$))", "u");
const CANONICAL_PRODUCTION_HOST = "dnd.faysk.dev";

/**
 * The same Production build can be staged at an immutable vercel.app hostname.
 * It uses the live Supabase/R2 configuration but MUST NOT accept mutations
 * before its canonical production domain has been explicitly promoted.
 * Only the canonical host is write-enabled (even after promotion).
 */
export function isStagedProductionMutation(request: NextRequest): boolean {
	if (process.env.VERCEL_ENV !== "production" || process.env.APP_ENV !== "production")
		return false;
	if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return false;
	return (
		request.nextUrl.hostname !== CANONICAL_PRODUCTION_HOST ||
		request.headers.get("host")?.split(":")[0] !== CANONICAL_PRODUCTION_HOST
	);
}

export async function proxy(request: NextRequest) {
	if (isStagedProductionMutation(request)) {
		return NextResponse.json(
			{ error: "staged_production_read_only" },
			{
				status: 403,
				headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
			},
		);
	}
	// Keep existing authentication, headers, cookies and caching behavior
	// limited to the original protected routes.
	if (!protectedAuthRoutes.test(request.nextUrl.pathname)) return NextResponse.next();
	let response = NextResponse.next({ request });
	const client = authClient({
		getAll: () => request.cookies.getAll(),
		setAll: (values) => {
			for (const { name, value } of values) request.cookies.set(name, value);
			response = NextResponse.next({ request });
			for (const { name, value, options } of values)
				response.cookies.set(name, value, options);
		},
	});
	try {
		await client?.auth.getUser();
	} catch {
		/* The data boundary denies unavailable sessions. */
	}
	response.headers.set("Cache-Control", "private, no-store");
	// HTML form POSTs need their same-origin Origin header for the CSRF guard.
	const authFormPage = ["/entrar", "/conta"].includes(request.nextUrl.pathname);
	response.headers.set(
		"Referrer-Policy",
		authFormPage ? "same-origin" : "no-referrer",
	);
	response.headers.set("X-Robots-Tag", "noindex, nofollow");
	return response;
}

export const config = {
	// All app routes are gated before reaching server actions/API handlers.
	// Exclude framework static/image paths so staging is not needlessly slowed.
	matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
