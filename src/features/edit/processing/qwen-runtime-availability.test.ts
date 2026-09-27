import { describe, expect, it, vi } from "vitest";
import {
	classifyQwenRuntimeReleaseAvailability,
	fetchQwenRuntimeReleaseAvailability,
	qwenRuntimeAvailabilityMessage,
	qwenRuntimeAvailabilitySuffix,
	QWEN_RUNTIME_STABLE_MANIFEST_PATH,
} from "./qwen-runtime-availability";

describe("Qwen runtime release availability", () => {
	it("classifies a published Stable below the required runtime floor", () => {
		const availability = classifyQwenRuntimeReleaseAvailability({
			channel: "stable",
			runtime_id: "qwen3-transformers",
			version: "1.0.11",
		});
		expect(availability).toEqual({ status: "below-minimum", version: "1.0.11" });
		expect(qwenRuntimeAvailabilitySuffix(availability)).toContain(
			"temporariamente indisponível",
		);
		expect(qwenRuntimeAvailabilityMessage(availability)).toContain(
			"abaixo do mínimo v1.0.12",
		);
		expect(qwenRuntimeAvailabilityMessage(availability)).not.toContain(
			"Atualize o runtime",
		);
	});

	it("offers an update only when Stable satisfies the required floor", () => {
		const availability = classifyQwenRuntimeReleaseAvailability({
			channel: "stable",
			runtime_id: "qwen3-transformers",
			version: "1.0.12",
		});
		expect(availability).toEqual({ status: "compatible", version: "1.0.12" });
		expect(qwenRuntimeAvailabilitySuffix(availability)).toContain(
			"atualizar runtime",
		);
		expect(qwenRuntimeAvailabilityMessage(availability)).toContain(
			"Stable v1.0.12 disponível",
		);
	});

	it("fails closed for malformed or unexpected manifest identities", () => {
		for (const value of [
			null,
			{},
			{ channel: "rc", runtime_id: "qwen3-transformers", version: "1.0.12" },
			{ channel: "stable", runtime_id: "other", version: "1.0.12" },
			{ channel: "stable", runtime_id: "qwen3-transformers", version: "development" },
		]) {
			expect(classifyQwenRuntimeReleaseAvailability(value)).toEqual({
				status: "unknown",
				version: null,
			});
		}
	});

	it("treats manifest lookup failure as unknown without claiming an update", async () => {
		const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
			new Response(JSON.stringify({ error: "QWEN_RUNTIME_RELEASE_LOOKUP_FAILED" }), {
				status: 503,
				headers: { "Content-Type": "application/json" },
			}),
		);
		const availability = await fetchQwenRuntimeReleaseAvailability(fetcher);
		expect(fetcher).toHaveBeenCalledWith(
			QWEN_RUNTIME_STABLE_MANIFEST_PATH,
			expect.objectContaining({
				cache: "no-store",
				credentials: "same-origin",
				redirect: "error",
			}),
		);
		expect(availability).toEqual({ status: "unknown", version: null });
		expect(qwenRuntimeAvailabilityMessage(availability)).toContain(
			"não pôde ser confirmada",
		);
		expect(qwenRuntimeAvailabilityMessage(availability)).not.toContain(
			"Atualize o runtime",
		);
	});

	it("keeps checking copy conservative before lookup completes", () => {
		expect(qwenRuntimeAvailabilitySuffix(null)).toContain("verificando runtime");
		expect(qwenRuntimeAvailabilityMessage(null)).toContain("Verificando");
	});
});
