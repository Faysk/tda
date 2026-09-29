import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveLorePresentation } from "./presentation";

const mocks = vi.hoisted(() => ({
	findPublishedLoreProfile: vi.fn(),
	notFound: vi.fn(),
}));

vi.mock("./repository", () => ({
	findPublishedLoreProfile: mocks.findPublishedLoreProfile,
}));

vi.mock("next/navigation", () => ({
	notFound: mocks.notFound,
}));

import { renderLoreRoutePage } from "./route-page";

describe("public lore route page", () => {
	beforeEach(() => {
		mocks.findPublishedLoreProfile.mockReset();
		mocks.notFound.mockReset();
		mocks.notFound.mockImplementation(() => {
			throw new Error("NEXT_NOT_FOUND");
		});
	});

	it("keeps an incompatible profile route as a 404 boundary", async () => {
		mocks.findPublishedLoreProfile.mockResolvedValue({
			identity: {
				id: "ivory",
				slug: "ivory",
				entityType: "npc",
				name: "Ivory",
			},
			presentation: resolveLorePresentation(),
			sections: [],
		});

		await expect(
			renderLoreRoutePage("personagens", "ivory"),
		).rejects.toThrow("NEXT_NOT_FOUND");
		expect(mocks.findPublishedLoreProfile).toHaveBeenCalledWith(
			"personagens",
			"ivory",
		);
		expect(mocks.notFound).toHaveBeenCalledOnce();
	});
});
