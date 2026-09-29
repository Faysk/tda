import { describe, expect, it } from "vitest";
import {
	TDA_BRAND_ASSETS,
	TDA_BRAND_MEDIA_ORIGIN,
	type TdaBrandAssetKey,
} from "./brand-assets";

const expectedFiles: Record<TdaBrandAssetKey, string> = {
	favicon: "favicon.svg",
	iconDuckBlack: "tda-icon-duck-black.svg",
	iconDuckWhite: "tda-icon-duck-white.svg",
	markBlack: "tda-mark-black.svg",
	markWhite: "tda-mark-white.svg",
};

describe("canonical TDA brand assets", () => {
	it("pins every runtime asset to the canonical media origin and immutable hash path", () => {
		for (const [key, assetUrl] of Object.entries(TDA_BRAND_ASSETS) as Array<
			[TdaBrandAssetKey, string]
		>) {
			const url = new URL(assetUrl);
			const [, namespace, sha256, file] = url.pathname.split("/");

			expect(url.origin).toBe(TDA_BRAND_MEDIA_ORIGIN);
			expect(namespace).toBe("brand");
			expect(sha256).toMatch(/^[a-f0-9]{64}$/u);
			expect(file).toBe(expectedFiles[key]);
			expect(url.search).toBe("");
			expect(url.hash).toBe("");
		}
	});
});
