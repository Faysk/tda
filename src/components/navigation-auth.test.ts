import { describe, expect, it } from "vitest";
import {
	isAuthenticatedNavigationState,
	parseNavigationAuthProjection,
} from "./navigation-auth";

describe("navigation auth projection", () => {
	it("keeps only the sanitized navigation fields supplied by the server", () => {
		expect(
			parseNavigationAuthProjection({
				state: "authenticated_linked",
				capabilities: ["campaign.local.process", 42, ""],
				identity: {
					displayName: "Renan",
					avatarUrl: "https://cdn.discordapp.com/avatars/123/hash.png",
					privateId: "must-not-project",
				},
				privateId: "must-not-project",
			}),
		).toEqual({
			state: "authenticated_linked",
			capabilities: ["campaign.local.process"],
			identity: {
				displayName: "Renan",
				avatarUrl: "https://cdn.discordapp.com/avatars/123/hash.png",
			},
		});
	});

	it("fails closed for anonymous, unavailable and malformed payloads", () => {
		expect(
			parseNavigationAuthProjection({
				state: "unavailable",
				capabilities: ["campaign.local.process"],
				identity: { displayName: "Stale", avatarUrl: "stale" },
			}),
		).toEqual({
			state: "unavailable",
			capabilities: [],
			identity: null,
		});
		expect(parseNavigationAuthProjection(null)).toEqual({
			state: "anonymous",
			capabilities: [],
			identity: null,
		});
	});

	it("recognizes only authenticated navigation states", () => {
		expect(isAuthenticatedNavigationState("authenticated_linked")).toBe(true);
		expect(isAuthenticatedNavigationState("authenticated_unlinked")).toBe(true);
		expect(isAuthenticatedNavigationState("anonymous")).toBe(false);
		expect(isAuthenticatedNavigationState("unavailable")).toBe(false);
	});
});
