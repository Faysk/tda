import { describe, expect, it, vi } from "vitest";
import { prepareEvidenceDownload } from "./benchmark-download";

const encode = (text: string) => new TextEncoder().encode(text);
function chunks(...parts: string[]) {
	return new ReadableStream<Uint8Array<ArrayBuffer>>({
		start(controller) {
			for (const part of parts) controller.enqueue(encode(part));
			controller.close();
		},
	});
}
describe("bounded evidence downloads without Content-Length", () => {
	it("downloads small chunked and empty responses as exact blobs", async () => {
		for (const parts of [[], ["PK", " evidence"]]) {
			const prepared = await prepareEvidenceDownload(chunks(...parts), 16);
			expect(prepared.stream).toBeNull();
			expect(await prepared.blob?.text()).toBe(parts.join(""));
		}
	});
	it("keeps the exact limit automatic", async () => {
		const prepared = await prepareEvidenceDownload(chunks("1234", "5678"), 8);
		expect(await prepared.blob?.text()).toBe("12345678");
	});
	it("preserves buffered prefix, overflow and remaining chunks when streaming", async () => {
		const prepared = await prepareEvidenceDownload(
			chunks("1234", "56789", "remaining"),
			8,
		);
		expect(prepared.blob).toBeNull();
		expect(await new Response(prepared.stream).text()).toBe(
			"123456789remaining",
		);
	});
	it("propagates cancellation to the original stream", async () => {
		const cancel = vi.fn();
		const body = new ReadableStream<Uint8Array<ArrayBuffer>>({
			start(controller) {
				controller.enqueue(encode("overflow"));
			},
			cancel,
		});
		const prepared = await prepareEvidenceDownload(body, 3);
		await prepared.stream?.cancel("operator cancelled");
		expect(cancel).toHaveBeenCalledWith("operator cancelled");
	});
	it("propagates a read failure without presenting a successful blob", async () => {
		const body = new ReadableStream<Uint8Array<ArrayBuffer>>({
			start(controller) {
				controller.error(new Error("network failed"));
			},
		});
		await expect(prepareEvidenceDownload(body, 8)).rejects.toThrow(
			"network failed",
		);
	});
	it("rejects invalid limits", async () => {
		await expect(prepareEvidenceDownload(chunks("data"), -1)).rejects.toThrow(
			"Invalid download limit",
		);
	});
});
