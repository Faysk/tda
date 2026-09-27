import { describe, expect, it, vi } from "vitest";
import {
	classifyQwenRuntimeReleaseManifest,
	fetchQwenRuntimeReleaseAvailability,
	qwenRuntimeReleaseLabel,
	qwenRuntimeReleaseMessage,
} from "./qwen-runtime-release-availability";

function manifest(version: string) {
	return {
		channel: "stable",
		runtime_id: "qwen3-transformers",
		version,
	};
}

describe("Qwen Stable runtime availability", () => {
	it("marks a published compatible runtime as actionable", () => {
		const result = classifyQwenRuntimeReleaseManifest(manifest("1.0.12"));
		expect(result).toEqual({ state: "available", stableVersion: "1.0.12" });
		expect(qwenRuntimeReleaseLabel(result)).toBe("atualizar runtime");
		expect(qwenRuntimeReleaseMessage(result)).toContain(
			"O canal Stable já oferece 1.0.12",
		);
	});

	it("marks an older Stable runtime as temporarily unavailable", () => {
		const result = classifyQwenRuntimeReleaseManifest(manifest("1.0.11"));
		expect(result).toEqual({ state: "unavailable", stableVersion: "1.0.11" });
		expect(qwenRuntimeReleaseLabel(result)).toBe(
			"temporariamente indisponível",
		);
		expect(qwenRuntimeReleaseMessage(result)).toContain(
			"canal Stable ainda publica 1.0.11",
		);
		expect(qwenRuntimeReleaseMessage(result)).not.toContain(
			"atualize o runtime/Companion",
		);
	});

	it("fails closed when Stable availability cannot be proven", async () => {
		for (const value of [
			null,
			{},
			manifest("1.0.12-rc.1"),
			{ ...manifest("1.0.12"), channel: "rc" },
		]) {
			expect(classifyQwenRuntimeReleaseManifest(value)).toEqual({
				state: "unknown",
				stableVersion: null,
			});
		}

		const request = vi
			.fn<typeof fetch>()
			.mockResolvedValue(Response.json({ error: "lookup failed" }, { status: 503 }));
		const result = await fetchQwenRuntimeReleaseAvailability(undefined, request);
		expect(result).toEqual({ state: "unknown", stableVersion: null });
		expect(qwenRuntimeReleaseLabel(result)).toBe(
			"disponibilidade não confirmada",
		);
		expect(qwenRuntimeReleaseMessage(result)).toContain(
			"não foi possível confirmar",
		);
	});
});
