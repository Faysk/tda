import { randomUUID, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_COOKIE, authConfig, safeReturnPath } from "./config";
import { discordAvailable } from "./provider";
import { serverAuthClient } from "./server";

const FLOW_COOKIE = "tda-discord-flow";

async function clearAuthCookies() {
	const jar = await cookies();
	for (const { name } of jar.getAll()) {
		if (
			name === AUTH_COOKIE ||
			name.startsWith(`${AUTH_COOKIE}.`) ||
			name.startsWith(`${AUTH_COOKIE}-`)
		)
			jar.delete(name);
	}
}

function response(path: string, origin: string) {
	const result = NextResponse.redirect(new URL(path, origin), 303);
	result.headers.set("Cache-Control", "private, no-store");
	result.headers.set("Referrer-Policy", "no-referrer");
	return result;
}

export async function startDiscord(request: Request) {
	const config = authConfig();
	if (!config)
		return new Response("Login temporariamente indisponível.", { status: 503 });
	if (request.headers.get("origin") !== config.origin)
		return new Response(null, { status: 403 });
	if (!(await discordAvailable()))
		return response("/entrar?erro=indisponivel", config.origin);
	try {
		const input = await request.formData();
		const next = safeReturnPath(input.get("next"));
		const nonce = randomUUID();
		const callback = new URL("/auth/callback", config.origin);
		callback.searchParams.set("flow", nonce);
		const client = await serverAuthClient();
		if (!client) return response("/entrar?erro=indisponivel", config.origin);
		const { data, error } = await client.auth.signInWithOAuth({
			provider: "discord",
			options: { redirectTo: callback.href, skipBrowserRedirect: true },
		});
		if (error || !data.url)
			return response("/entrar?erro=inicio", config.origin);
		const jar = await cookies();
		jar.set(FLOW_COOKIE, JSON.stringify({ nonce, next }), {
			httpOnly: true,
			secure: config.secure,
			sameSite: "lax",
			path: "/",
			maxAge: 600,
		});
		return response(data.url, config.origin);
	} catch {
		return response("/entrar?erro=inicio", config.origin);
	}
}

export async function finishDiscord(request: Request) {
	const config = authConfig();
	if (!config)
		return new Response("Login temporariamente indisponível.", { status: 503 });
	const jar = await cookies();
	const input = new URL(request.url).searchParams;
	let flow: { nonce?: string; next?: string } = {};
	try {
		const parsed = JSON.parse(jar.get(FLOW_COOKIE)?.value ?? "{}");
		if (
			parsed &&
			typeof parsed.nonce === "string" &&
			typeof parsed.next === "string"
		)
			flow = parsed;
	} catch {
		/* Invalid state is denied. */
	}
	jar.delete(FLOW_COOKIE);
	const nonce = input.get("flow") ?? "";
	const expected = flow.nonce ?? "";
	if (
		!/^[0-9a-f-]{36}$/u.test(nonce) ||
		!/^[0-9a-f-]{36}$/u.test(expected) ||
		nonce.length !== expected.length ||
		!timingSafeEqual(Buffer.from(nonce), Buffer.from(expected))
	)
		return response("/entrar?erro=sessao", config.origin);
	if (input.has("error"))
		return response(
			input.get("error") === "access_denied"
				? "/entrar?erro=cancelado"
				: "/entrar?erro=callback",
			config.origin,
		);
	const code = input.get("code");
	if (!code || code.length > 4096)
		return response("/entrar?erro=callback", config.origin);
	try {
		const client = await serverAuthClient();
		if (!client) return response("/entrar?erro=indisponivel", config.origin);
		const { error } = await client.auth.exchangeCodeForSession(code);
		if (error) return response("/entrar?erro=callback", config.origin);
		const { data, error: userError } = await client.auth.getUser();
		if (
			userError ||
			!data.user?.identities?.some(
				(identity) => identity.provider === "discord",
			)
		) {
			try {
				await client.auth.signOut({ scope: "local" });
			} finally {
				await clearAuthCookies();
			}
			return response("/entrar?erro=callback", config.origin);
		}
		return response(safeReturnPath(flow.next), config.origin);
	} catch {
		await clearAuthCookies();
		return response("/entrar?erro=callback", config.origin);
	}
}

export async function logout(request: Request) {
	const config = authConfig();
	if (!config || request.headers.get("origin") !== config.origin)
		return new Response(null, { status: 403 });
	let failed = false;
	try {
		const client = await serverAuthClient();
		const result = await client?.auth.signOut({ scope: "local" });
		failed = Boolean(result?.error);
	} catch {
		failed = true;
	}
	const jar = await cookies();
	for (const { name } of jar.getAll())
		if (
			name === AUTH_COOKIE ||
			name.startsWith(`${AUTH_COOKIE}.`) ||
			name.startsWith(`${AUTH_COOKIE}-`) ||
			name === FLOW_COOKIE
		)
			jar.delete(name);
	return response(
		failed ? "/entrar?erro=saida" : "/entrar?saida=1",
		config.origin,
	);
}
