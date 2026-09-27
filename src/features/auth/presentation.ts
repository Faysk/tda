export type NavigationIdentity = Readonly<{
	displayName: string | null;
	avatarUrl: string | null;
}>;

const DISPLAY_NAME_LIMIT = 80;
const DISCORD_AVATAR_HOST = "cdn.discordapp.com";
const DISCORD_AVATAR_PATHS = ["/avatars/", "/embed/avatars/"] as const;
function isUnsafeDisplayCodePoint(codePoint: number): boolean {
	return (
		codePoint <= 0x1f ||
		(codePoint >= 0x7f && codePoint <= 0x9f) ||
		(codePoint >= 0x200b && codePoint <= 0x200f) ||
		(codePoint >= 0x202a && codePoint <= 0x202e) ||
		(codePoint >= 0x2060 && codePoint <= 0x206f) ||
		codePoint === 0xfeff
	);
}

function stripUnsafeDisplayControls(value: string): string {
	return Array.from(value, (character) => {
		const codePoint = character.codePointAt(0);
		return codePoint !== undefined && isUnsafeDisplayCodePoint(codePoint)
			? " "
			: character;
	}).join("");
}

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

export function sanitizeNavigationDisplayName(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const cleaned = stripUnsafeDisplayControls(value)
		.replace(/\s+/gu, " ")
		.trim();
	if (!cleaned) return null;
	return Array.from(cleaned).slice(0, DISPLAY_NAME_LIMIT).join("").trim() || null;
}

function navigationDisplayName(
	metadata: Record<string, unknown>,
): string | null {
	for (const key of [
		"full_name",
		"global_name",
		"name",
		"preferred_username",
		"user_name",
		"username",
	] as const) {
		const candidate = sanitizeNavigationDisplayName(metadata[key]);
		if (candidate) return candidate;
	}
	return sanitizeNavigationDisplayName(
		record(metadata.custom_claims)?.global_name,
	);
}

export function sanitizeDiscordAvatarUrl(value: unknown): string | null {
	if (typeof value !== "string") return null;
	try {
		const url = new URL(value);
		if (
			url.protocol !== "https:" ||
			url.hostname !== DISCORD_AVATAR_HOST ||
			url.port ||
			url.username ||
			url.password ||
			!DISCORD_AVATAR_PATHS.some((prefix) => url.pathname.startsWith(prefix))
		) {
			return null;
		}
		url.search = "";
		url.hash = "";
		return url.toString();
	} catch {
		return null;
	}
}

export function navigationIdentityFromMetadata(
	value: unknown,
): NavigationIdentity {
	const metadata = record(value);
	if (!metadata) return { displayName: null, avatarUrl: null };
	return {
		displayName: navigationDisplayName(metadata),
		avatarUrl:
			sanitizeDiscordAvatarUrl(metadata.avatar_url) ??
			sanitizeDiscordAvatarUrl(metadata.picture),
	};
}
