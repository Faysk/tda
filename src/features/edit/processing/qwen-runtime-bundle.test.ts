import { describe, expect, it } from "vitest";
import { parseQwenRuntimeBundle } from "./qwen-runtime-bundle";

function bundle() {
	return {
		schema: "tda_qwen_runtime_bundle_v1",
		runtime_id: "qwen3-transformers",
		platform: "windows-x64",
		version: "1.2.3",
		archive: {
			name: "TDAQwenRuntime-1.2.3-windows-x64.zip",
			size: 30,
			sha256: "a".repeat(64),
		},
		parts: [
			{
				index: 1,
				name: "TDAQwenRuntime-1.2.3-windows-x64.zip.part001",
				size: 10,
				sha256: "b".repeat(64),
			},
			{
				index: 2,
				name: "TDAQwenRuntime-1.2.3-windows-x64.zip.part002",
				size: 20,
				sha256: "c".repeat(64),
			},
		],
	};
}

describe("parseQwenRuntimeBundle", () => {
	it("accepts a contiguous, hash-addressed Windows bundle", () => {
		expect(parseQwenRuntimeBundle(bundle(), "1.2.3")).toEqual(bundle());
	});

	it("rejects identity/version/name mismatches", () => {
		const wrongRuntime = bundle();
		wrongRuntime.runtime_id = "other";
		expect(parseQwenRuntimeBundle(wrongRuntime)).toBeNull();
		expect(parseQwenRuntimeBundle(bundle(), "1.2.4")).toBeNull();
		const wrongName = bundle();
		wrongName.parts[1].name = "../part002";
		expect(parseQwenRuntimeBundle(wrongName)).toBeNull();
	});

	it("rejects broken sequence, totals and hashes", () => {
		const sequence = bundle();
		sequence.parts[1].index = 3;
		expect(parseQwenRuntimeBundle(sequence)).toBeNull();
		const total = bundle();
		total.archive.size = 31;
		expect(parseQwenRuntimeBundle(total)).toBeNull();
		const digest = bundle();
		digest.parts[0].sha256 = "sha256:bad";
		expect(parseQwenRuntimeBundle(digest)).toBeNull();
	});

	it("rejects a release-sized part at or above 2 GiB", () => {
		const value = bundle();
		value.parts = [
			{
				index: 1,
				name: "TDAQwenRuntime-1.2.3-windows-x64.zip.part001",
				size: 2 * 1024 ** 3,
				sha256: "b".repeat(64),
			},
		];
		value.archive.size = 2 * 1024 ** 3;
		expect(parseQwenRuntimeBundle(value)).toBeNull();
	});
});
