import { describe, expect, it } from "vitest";
import {
	navigationIdentityFromMetadata,
	sanitizeDiscordAvatarUrl,
	sanitizeNavigationDisplayName,
} from "./presentation";

describe("navigation identity presentation", () => {
	it("normalizes display names, removes controls and preserves Unicode", () => {
		expect(sanitizeNavigationDisplayName("  Renan\u0000   Silva  ")).toBe(
			"Renan Silva",
		);
		expect(sanitizeNavigationDisplayName("🦉".repeat(81))).toBe("🦉".repeat(80));
		expect(sanitizeNavigationDisplayName("\u202e\u200b")).toBeNull();
	});

	it("uses the first non-empty supported display name candidate", () => {
		expect(
			navigationIdentityFromMetadata({
				full_name: "   ",
				name: "  Faysk  ",
			}),
		).toEqual({ displayName: "Faysk", avatarUrl: null });
		expect(
			navigationIdentityFromMetadata({
				custom_claims: { global_name: "Corujinha" },
			}),
		).toEqual({ displayName: "Corujinha", avatarUrl: null });
	});

	it("accepts only Discord CDN avatar paths and strips transport decoration", () => {
		expect(
			sanitizeDiscordAvatarUrl(
				"https://cdn.discordapp.com/avatars/123/hash.png?size=128#fragment",
			),
		).toBe("https://cdn.discordapp.com/avatars/123/hash.png");
		expect(
			sanitizeDiscordAvatarUrl(
				"https://cdn.discordapp.com/embed/avatars/2.png",
			),
		).toBe("https://cdn.discordapp.com/embed/avatars/2.png");
	});

	it.each([
		"http://cdn.discordapp.com/avatars/123/hash.png",
		"https://cdn.discordapp.com.evil.test/avatars/123/hash.png",
		"https://evil.test/avatars/123/hash.png",
		"https://user:pass@cdn.discordapp.com/avatars/123/hash.png",
		"https://cdn.discordapp.com:444/avatars/123/hash.png",
		"https://cdn.discordapp.com/attachments/123/file.png",
		"not-a-url",
	])("rejects untrusted avatar URL %s", (value) => {
		expect(sanitizeDiscordAvatarUrl(value)).toBeNull();
	});

	it("falls back from an invalid avatar_url to a valid provider picture", () => {
		expect(
			navigationIdentityFromMetadata({
				full_name: "Renan",
				avatar_url: "https://evil.test/avatar.png",
				picture: "https://cdn.discordapp.com/avatars/123/hash.webp",
			}),
		).toEqual({
			displayName: "Renan",
			avatarUrl: "https://cdn.discordapp.com/avatars/123/hash.webp",
		});
	});

	it("returns a safe empty presentation for malformed metadata", () => {
		expect(navigationIdentityFromMetadata(["private"])).toEqual({
			displayName: null,
			avatarUrl: null,
		});
	});
});
