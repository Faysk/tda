import { describe, expect, it } from "vitest";
import {
	selectCompanionAsset,
	selectCompanionAssetInfo,
	selectLatestCompanionTag,
} from "./companion-release";

function release(
	tag: string,
	options: {
		draft?: boolean;
		prerelease?: boolean;
		url?: string;
		digest?: string;
		size?: number;
	} = {},
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
				digest: options.digest ?? `sha256:${"a".repeat(64)}`,
				size: options.size ?? 16_000_000,
			},
		],
	};
}

describe("selectLatestCompanionTag", () => {
	it("selects the greatest companion semantic version from matching refs", () => {
		expect(
			selectLatestCompanionTag([
				{ ref: "refs/tags/companion-v0.2.0" },
				{ ref: "refs/tags/companion-v1.0.0" },
				{ ref: "refs/tags/companion-v0.12.4" },
				{ ref: "refs/tags/prod-abcdef123456" },
			]),
		).toBe("companion-v1.0.0");
	});

	it("ignores malformed tags", () => {
		expect(
			selectLatestCompanionTag([
				{ ref: "refs/tags/companion-v1.0" },
				{ ref: "refs/tags/companion-v1.0.0-beta" },
				{ ref: "refs/heads/companion-v9.0.0" },
			]),
		).toBeNull();
	});
});

describe("selectCompanionAsset", () => {
	it("accepts the official MSI asset for the selected release", () => {
		expect(
			selectCompanionAsset(release("companion-v0.2.0"), "companion-v0.2.0"),
		).toBe(
			"https://github.com/Faysk/tda/releases/download/companion-v0.2.0/TDACompanion-x64.msi",
		);
	});

	it("rejects a draft, prerelease or mismatched release", () => {
		expect(
			selectCompanionAsset(
				release("companion-v0.2.0", { draft: true }),
				"companion-v0.2.0",
			),
		).toBeNull();
		expect(
			selectCompanionAsset(
				release("companion-v0.2.0", { prerelease: true }),
				"companion-v0.2.0",
			),
		).toBeNull();
		expect(
			selectCompanionAsset(release("companion-v0.2.0"), "companion-v0.3.0"),
		).toBeNull();
	});

	it("rejects assets outside the exact official release path", () => {
		expect(
			selectCompanionAsset(
				release("companion-v0.2.0", {
					url: "https://example.com/TDACompanion-x64.msi",
				}),
				"companion-v0.2.0",
			),
		).toBeNull();
	});
});

describe("selectCompanionAssetInfo", () => {
	it("returns the version, size and sha256 only for a validated asset", () => {
		expect(
			selectCompanionAssetInfo(release("companion-v0.3.0"), "companion-v0.3.0"),
		).toEqual({
			tag: "companion-v0.3.0",
			version: "0.3.0",
			url: "https://github.com/Faysk/tda/releases/download/companion-v0.3.0/TDACompanion-x64.msi",
			sha256: "a".repeat(64),
			size: 16_000_000,
		});
	});

	it("fails closed when digest or size metadata is missing or malformed", () => {
		expect(
			selectCompanionAssetInfo(
				release("companion-v0.3.0", { digest: "md5:deadbeef" }),
				"companion-v0.3.0",
			),
		).toBeNull();
		expect(
			selectCompanionAssetInfo(
				release("companion-v0.3.0", { size: 0 }),
				"companion-v0.3.0",
			),
		).toBeNull();
	});
});
