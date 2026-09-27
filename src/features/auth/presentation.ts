export type NavigationIdentity = Readonly<{
	displayName: string | null;
	avatarUrl: string | null;
}>;

const DISPLAY_NAME_LIMIT = 80;
const DISCORD_AVATAR_HOST = "cdn.discordapp.com";
const DISCORD_AVATAR_PATHS = ["/avatars/", "/embed/avatars/"] as const;
const UNSAFE_DISPLAY_CONTROLS =
	/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu;

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

export function sanitizeNavigationDisplayName(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const cleaned = value
		.replace(UNSAFE_DISPLAY_CONTROLS, " ")
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
