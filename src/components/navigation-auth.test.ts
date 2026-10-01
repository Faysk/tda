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
			campaignsState: "none",
			campaigns: [],
		});
		expect(
			parseNavigationAuthProjection({
				state: "unavailable",
				identity: { displayName: "stale", avatarUrl: "https://example.test/a" },
				capabilities: ["campaign.local.process"],
				campaignsState: "first_class",
				campaigns: [
					{
						technicalSlug: "private",
						name: "Private",
						lifecycle: "active",
					},
				],
			}),
		).toEqual({
			state: "unavailable",
			identity: null,
			capabilities: [],
			campaignsState: "unavailable",
			campaigns: [],
		});
	});

	it("accepts only the minimal authenticated campaign projection", () => {
		expect(
			parseNavigationAuthProjection({
				state: "authenticated_linked",
				identity: {
					displayName: "Renan Silva",
					avatarUrl: "https://cdn.discordapp.com/avatars/123/hash.png",
					privateId: "do-not-copy",
				},
				capabilities: [],
				campaignsState: "first_class",
				campaigns: [
					{
						id: "never-copy-this-uuid",
						technicalSlug: "yuhara-main",
						routeKey: "cronicas-da-mesa",
						name: "Crônicas da Mesa",
						lifecycle: "active",
						capabilities: [
							"campaign.transcript.read",
							null,
							"",
							"campaign.local.process",
						],
						rawGrants: ["private"],
					},
				],
				rawGrants: ["private"],
			}),
		).toEqual({
			state: "authenticated_linked",
			identity: {
				displayName: "Renan Silva",
				avatarUrl: "https://cdn.discordapp.com/avatars/123/hash.png",
			},
			capabilities: [],
			campaignsState: "first_class",
			campaigns: [
				{
					technicalSlug: "yuhara-main",
					routeKey: "cronicas-da-mesa",
					name: "Crônicas da Mesa",
					lifecycle: "active",
					capabilities: [
						"campaign.transcript.read",
						"campaign.local.process",
					],
				},
			],
		});
	});

	it("fails the campaign projection closed on malformed or missing discovery state", () => {
		expect(
			parseNavigationAuthProjection({
				state: "authenticated_linked",
				identity: { displayName: "Pessoa", avatarUrl: null },
				campaignsState: "first_class",
				campaigns: [{ technicalSlug: "", name: "Broken", lifecycle: "active" }],
			}),
		).toEqual({
			state: "authenticated_linked",
			identity: { displayName: "Pessoa", avatarUrl: null },
			capabilities: [],
			campaignsState: "unavailable",
			campaigns: [],
		});
		expect(
			parseNavigationAuthProjection({
				state: "authenticated_linked",
				identity: { displayName: "Pessoa", avatarUrl: null },
			}).campaignsState,
		).toBe("unavailable");
	});

	it("fails closed on unknown payloads", () => {
		expect(parseNavigationAuthProjection({ state: "owner" })).toEqual({
			state: "unavailable",
			identity: null,
			capabilities: [],
			campaignsState: "unavailable",
			campaigns: [],
		});
		expect(parseNavigationAuthProjection(null)).toEqual({
			state: "unavailable",
			identity: null,
			capabilities: [],
			campaignsState: "unavailable",
			campaigns: [],
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
