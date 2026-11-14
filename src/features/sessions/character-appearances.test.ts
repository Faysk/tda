import { describe, expect, it } from "vitest";
import {
	projectPublicCharacterAppearances,
	type PublicAppearanceContext,
	type ReviewedCharacterAppearance,
} from "./character-appearances";

const context: PublicAppearanceContext = {
	campaignId: "campaign-a",
	sessionId: "session-a",
	sessionStatus: "published",
	campaignLifecycle: "active",
	campaignVisibility: "public",
};

const approved: ReviewedCharacterAppearance = {
	campaignId: "campaign-a",
	sessionId: "session-a",
	characterEntityId: "internal-private-uuid",
	entityType: "pc",
	entityVisibility: "public_web",
	publicRef: "astel",
	approvedForPublic: true,
};

describe("reviewed session character appearances", () => {
	it("publishes only explicitly approved web-public references", () => {
		const input: ReviewedCharacterAppearance[] = [
			approved,
			{ ...approved, publicRef: "screaky" },
			{ ...approved, publicRef: "astel" },
			{ ...approved, publicRef: "secret-master", entityVisibility: "private_master" },
			{ ...approved, publicRef: "party-secret", entityVisibility: "private_players" },
			{ ...approved, publicRef: "campaign-only", entityVisibility: "public_campaign" },
			{ ...approved, publicRef: "not-reviewed", approvedForPublic: false },
			{ ...approved, publicRef: "unauthorized", entityVisibility: "review_only" },
		];
		const output = projectPublicCharacterAppearances(context, input);
		expect(output).toEqual(["astel", "screaky"]);
		expect(JSON.stringify(output)).not.toContain("internal-private-uuid");
		expect(JSON.stringify(output)).not.toContain("secret");
	});

	it("never mixes campaigns, sessions, or unpublished entities", () => {
		const output = projectPublicCharacterAppearances(context, [
			approved,
			{ ...approved, campaignId: "campaign-b", publicRef: "other-campaign" },
			{ ...approved, sessionId: "session-b", publicRef: "other-session" },
			{ ...approved, entityType: "npc", publicRef: "leonard" },
		]);
		expect(output).toEqual(["astel", "leonard"]);
		for (const change of [
			{ sessionStatus: "draft" },
			{ sessionStatus: "ready_for_review" },
			{ campaignLifecycle: "archived" },
			{ campaignVisibility: "private" },
			{ campaignId: "" },
			{ sessionId: "" },
		]) {
			expect(projectPublicCharacterAppearances({ ...context, ...change }, [approved]))
				.toEqual([]);
		}
	});

	it("rejects malformed references and never resolves aliases implicitly", () => {
		const inputs: ReviewedCharacterAppearance[] = [
			{ ...approved, publicRef: "Primordial-Memoria" },
			{ ...approved, publicRef: "../../private" },
			{ ...approved, publicRef: "" },
			{ ...approved, publicRef: null },
			{ ...approved, publicRef: "x".repeat(101) },
			{ ...approved, publicRef: "astel", approvedForPublic: false },
		];
		expect(projectPublicCharacterAppearances(context, inputs)).toEqual([]);
	});

	it("produces no assertions of absence when there are no reviewed rows", () => {
		expect(projectPublicCharacterAppearances(context, [])).toEqual([]);
	});
});
