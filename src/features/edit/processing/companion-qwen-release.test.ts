import { describe, expect, it } from "vitest";
import {
	qwenRuntimeBundleManifestName,
	selectLatestQwenRuntimeTag,
	selectQwenRuntimeBundleManifestAssetInfo,
	selectQwenRuntimePartAssetInfo,
} from "./companion-release";

function release(version = "1.2.3") {
	const tag = `companion-qwen-runtime-v${version}`;
	const manifest = `TDAQwenRuntimeBundle-${version}-windows-x64.json`;
	const part = `TDAQwenRuntime-${version}-windows-x64.zip.part001`;
	return {
		tag_name: tag,
		draft: false,
		prerelease: false,
		assets: [
			{
				name: manifest,
				browser_download_url: `https://github.com/Faysk/tda/releases/download/${tag}/${manifest}`,
				digest: `sha256:${"a".repeat(64)}`,
				size: 2048,
			},
			{
				name: part,
				browser_download_url: `https://github.com/Faysk/tda/releases/download/${tag}/${part}`,
				digest: `sha256:${"b".repeat(64)}`,
				size: 1_900_000_000,
			},
		],
	};
}

describe("Qwen runtime release selection", () => {
	it("selects only the latest Qwen runtime namespace", () => {
		expect(
			selectLatestQwenRuntimeTag([
				{ ref: "refs/tags/companion-v9.0.0" },
				{ ref: "refs/tags/companion-whisper-runtime-v9.0.0" },
				{ ref: "refs/tags/companion-qwen-runtime-v1.2.3" },
				{ ref: "refs/tags/companion-qwen-runtime-v2.0.0" },
			]),
		).toBe("companion-qwen-runtime-v2.0.0");
	});

	it("derives and validates the exact bundle manifest asset", () => {
		const tag = "companion-qwen-runtime-v1.2.3";
		expect(qwenRuntimeBundleManifestName(tag)).toBe(
			"TDAQwenRuntimeBundle-1.2.3-windows-x64.json",
		);
		expect(selectQwenRuntimeBundleManifestAssetInfo(release(), tag)).toEqual({
			tag,
			version: "1.2.3",
			url: "https://github.com/Faysk/tda/releases/download/companion-qwen-runtime-v1.2.3/TDAQwenRuntimeBundle-1.2.3-windows-x64.json",
			sha256: "a".repeat(64),
			size: 2048,
		});
	});

	it("accepts only version-matched numbered runtime parts", () => {
		const tag = "companion-qwen-runtime-v1.2.3";
		const part = "TDAQwenRuntime-1.2.3-windows-x64.zip.part001";
		expect(selectQwenRuntimePartAssetInfo(release(), tag, part)?.sha256).toBe(
			"b".repeat(64),
		);
		expect(
			selectQwenRuntimePartAssetInfo(
				release(),
				tag,
				"TDAQwenRuntime-1.2.4-windows-x64.zip.part001",
			),
		).toBeNull();
		expect(
			selectQwenRuntimePartAssetInfo(release(), tag, "../runtime.part001"),
		).toBeNull();
	});

	it("fails closed on draft releases and malformed digest metadata", () => {
		const tag = "companion-qwen-runtime-v1.2.3";
		const draft = release();
		draft.draft = true;
		expect(selectQwenRuntimeBundleManifestAssetInfo(draft, tag)).toBeNull();
		const bad = release();
		bad.assets[0].digest = "sha1:bad";
		expect(selectQwenRuntimeBundleManifestAssetInfo(bad, tag)).toBeNull();
	});
});
