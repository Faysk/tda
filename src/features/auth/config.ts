export function authConfig() {
	const url = process.env.SUPABASE_URL;
	const key = process.env.SUPABASE_PUBLISHABLE_KEY;
	const origin = process.env.TDA_AUTH_ORIGIN;
	if (!url || !key || !origin) return null;
	try {
		const parsed = new URL(origin);
		if (parsed.origin !== origin || parsed.username || parsed.password)
			return null;
		if (
			parsed.protocol !== "https:" &&
			!(
				parsed.protocol === "http:" &&
				["localhost", "127.0.0.1"].includes(parsed.hostname)
			)
		)
			return null;
		if (!key.startsWith("sb_publishable_")) return null;
		return { url, key, origin, secure: parsed.protocol === "https:" };
	} catch {
		return null;
	}
}

export const AUTH_COOKIE = "tda-discord-session";

export function safeReturnPath(value: unknown): string {
	if (typeof value !== "string" || value.length > 2048) return "/conta";
	// Reject encoded separators/control characters too, before URL normalization.
	let decoded = value;
	try {
		for (let i = 0; i < 3; i++) decoded = decodeURIComponent(decoded);
	} catch {
		return "/conta";
	}
	if (
		!decoded.startsWith("/") ||
		decoded.startsWith("//") ||
		Array.from(decoded).some(
			(char) =>
				char === "\\" || char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127,
		)
	)
		return "/conta";
	const target = new URL(decoded, "https://tda.invalid");
	if (
		target.origin !== "https://tda.invalid" ||
		/^\/(?:auth|api|entrar)(?:\/|$)/u.test(target.pathname)
	)
		return "/conta";
	return `${target.pathname}${target.search}${target.hash}`;
}
