import { describe, expect, it, vi } from "vitest";
import { copyUrlToClipboard } from "./session-share-actions";

describe("copyUrlToClipboard", () => {
	it("copies the public URL when Clipboard API is available", async () => {
		const writeText = vi.fn(async () => undefined);
		await expect(
			copyUrlToClipboard("https://dnd.faysk.dev/sessoes/exemplo", { writeText }),
		).resolves.toBe(true);
		expect(writeText).toHaveBeenCalledOnce();
		expect(writeText).toHaveBeenCalledWith(
			"https://dnd.faysk.dev/sessoes/exemplo",
		);
	});

	it("returns false when Clipboard API is unavailable", async () => {
		await expect(
			copyUrlToClipboard("https://dnd.faysk.dev/sessoes/exemplo", undefined),
		).resolves.toBe(false);
	});

	it("does not convert clipboard permission denial into success", async () => {
		const error = new Error("permission denied");
		const writeText = vi.fn(async () => {
			throw error;
		});
		await expect(
			copyUrlToClipboard("https://dnd.faysk.dev/sessoes/exemplo", { writeText }),
		).rejects.toBe(error);
	});
});
