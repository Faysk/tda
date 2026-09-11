import { describe, expect, it } from "vitest";
import { selectLatestCompanionAsset } from "./companion-release";

function release(
	tag: string,
	options: { draft?: boolean; prerelease?: boolean; url?: string } = {},
) {
	return {
		tag_name: tag,
		draft: options.draft ?? false,
		prerelease: options.prerelease ?? false,
		assets: [
			{
				name: "TDACompanion-x64.msi",
				browser_download_url:
					options.url ??
					`https://github.com/Faysk/tda/releases/download/${tag}/TDACompanion-x64.msi`,
			},
		],
	};
}

describe("selectLatestCompanionAsset", () => {
	it("selects the greatest companion semantic version", () => {
		expect(
			selectLatestCompanionAsset([
				release("companion-v0.2.0"),
				release("companion-v1.0.0"),
				release("companion-v0.12.4"),
			]),
		).toBe(
			"https://github.com/Faysk/tda/releases/download/companion-v1.0.0/TDACompanion-x64.msi",
		);
	});

	it("ignores production releases and prerelease/draft companions", () => {
		expect(
			selectLatestCompanionAsset([
				release("companion-v0.2.0"),
				{
					tag_name: "prod-abcdef123456",
					draft: false,
					prerelease: false,
					assets: [],
				},
				release("companion-v9.0.0", { prerelease: true }),
				release("companion-v8.0.0", { draft: true }),
			]),
		).toBe(
			"https://github.com/Faysk/tda/releases/download/companion-v0.2.0/TDACompanion-x64.msi",
		);
	});

	it("rejects assets outside the official release path", () => {
		expect(
			selectLatestCompanionAsset([
				release("companion-v0.2.0", {
					url: "https://example.com/TDACompanion-x64.msi",
				}),
			]),
		).toBeNull();
	});

	it("returns null for malformed release responses", () => {
		expect(selectLatestCompanionAsset({ releases: [] })).toBeNull();
		expect(selectLatestCompanionAsset([])).toBeNull();
	});
});
