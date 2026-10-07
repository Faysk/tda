import { gunzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { encodePublicationTransport } from "./publication-transport";
import { PUBLICATION_GZIP_CONTENT_TYPE } from "../../transcript-publication/transport-contract";

describe("bounded publication transport", () => {
	it("retains small JSON compatibility", async () => {
		expect(await encodePublicationTransport('{"text":"Olá"}')).toEqual({
			ok: true,
			body: '{"text":"Olá"}',
			contentType: "application/json",
		});
	});
	it("round-trips a host-sized Unicode payload byte for byte", async () => {
		const raw = JSON.stringify({
			rows: Array.from({ length: 9000 }, (_, id) => ({
				id,
				text: "Olá sessão 🦆 ".repeat(35),
			})),
		});
		expect(new TextEncoder().encode(raw).length).toBeGreaterThan(4_500_000);
		const result = await encodePublicationTransport(raw);
		expect(result.ok).toBe(true);
		if (!result.ok || typeof result.body === "string")
			throw new Error("expected gzip");
		expect(result.contentType).toBe(PUBLICATION_GZIP_CONTENT_TYPE);
		expect(result.body.size).toBeLessThan(4 * 1024 * 1024);
		expect(
			gunzipSync(Buffer.from(await result.body.arrayBuffer())).toString("utf8"),
		).toBe(raw);
	});
	it("fails closed when compression is unavailable and never sends oversize JSON", async () => {
		vi.stubGlobal("CompressionStream", undefined);
		try {
			expect(
				await encodePublicationTransport("a".repeat(2 * 1024 * 1024)),
			).toEqual({ ok: false, reason: "dependency_unavailable" });
		} finally {
			vi.unstubAllGlobals();
		}
	});
	it("rejects raw data beyond the existing domain bound", async () => {
		expect(
			await encodePublicationTransport("a".repeat(35 * 1024 * 1024)),
		).toEqual({ ok: false, reason: "too_large" });
	});
});
