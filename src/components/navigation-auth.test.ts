import { describe, expect, it } from "vitest";
import {
	isAuthenticatedNavigationState,
	navigationInitials,
	parseNavigationAuthProjection,
} from "./navigation-auth";

describe("navigation auth projection", () => {
	it("keeps anonymous and unavailable states private", () => {
		expect(parseNavigationAuthProjection({ state: "anonymous" })).toEqual({
			state: "anonymous",
			identity: null,
			capabilities: [],
		});
		expect(
			parseNavigationAuthProjection({
				state: "unavailable",
				identity: { displayName: "stale", avatarUrl: "https://example.test/a" },
				capabilities: ["campaign.local.process"],
			}),
		).toEqual({
			state: "unavailable",
			identity: null,
			capabilities: [],
		});
	});

	it("accepts only the minimal authenticated navigation projection", () => {
		expect(
			parseNavigationAuthProjection({
				state: "authenticated_linked",
				identity: {
					displayName: "Renan Silva",
					avatarUrl: "https://cdn.discordapp.com/avatars/123/hash.png",
					privateId: "do-not-copy",
				},
				capabilities: [
					"campaign.transcript.read",
					null,
					"",
					"campaign.local.process",
				],
				rawGrants: ["private"],
			}),
		).toEqual({
			state: "authenticated_linked",
			identity: {
				displayName: "Renan Silva",
				avatarUrl: "https://cdn.discordapp.com/avatars/123/hash.png",
			},
			capabilities: [
				"campaign.transcript.read",
				"campaign.local.process",
			],
		});
	});

	it("fails closed on unknown payloads", () => {
		expect(parseNavigationAuthProjection({ state: "owner" })).toEqual({
			state: "unavailable",
			identity: null,
			capabilities: [],
		});
		expect(parseNavigationAuthProjection(null)).toEqual({
			state: "unavailable",
			identity: null,
			capabilities: [],
		});
	});

	it("classifies authenticated states explicitly", () => {
		expect(isAuthenticatedNavigationState("authenticated_unlinked")).toBe(true);
		expect(isAuthenticatedNavigationState("authenticated_linked")).toBe(true);
		expect(
			isAuthenticatedNavigationState("authenticated_linked_no_grants"),
		).toBe(true);
		expect(isAuthenticatedNavigationState("anonymous")).toBe(false);
		expect(isAuthenticatedNavigationState("unavailable")).toBe(false);
	});

	it("derives compact fallback initials without losing Unicode", () => {
		expect(navigationInitials("Renan Gomes da Silva")).toBe("RS");
		expect(navigationInitials("faysk")).toBe("F");
		expect(navigationInitials("🦉 Coruja")).toBe("🦉C");
		expect(navigationInitials(null)).toBeNull();
	});
});
