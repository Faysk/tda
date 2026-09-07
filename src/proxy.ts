import { NextResponse, type NextRequest } from "next/server";
import { authClient } from "./features/auth/client";

export async function proxy(request: NextRequest) {
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
	matcher: ["/edit/:path*", "/conta", "/entrar", "/api/auth/:path*"],
};
