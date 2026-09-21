import { describe, expect, it } from "vitest";
import { inspectLembraImage } from "./image";

const PNG_1X1 = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl5n6sAAAAASUVORK5CYII=",
	"base64",
);

describe("Lembra image inspection", () => {
	it("derives MIME, dimensions, size and hash from PNG bytes", () => {
		const inspected = inspectLembraImage(PNG_1X1);
		expect(inspected.mimeType).toBe("image/png");
		expect(inspected.extension).toBe("png");
		expect(inspected.width).toBe(1);
		expect(inspected.height).toBe(1);
		expect(inspected.bytes).toBe(PNG_1X1.length);
		expect(inspected.sha256).toMatch(/^[a-f0-9]{64}$/u);
	});

	it("rejects unsupported bytes regardless of filename or declared MIME", () => {
		expect(() =>
			inspectLembraImage(Buffer.from("not-an-image-but-long-enough-to-test")),
		).toThrow("LEMBRA_MEDIA_UNSUPPORTED_IMAGE");
	});
});
