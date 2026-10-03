import { inflateSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";

type DecodedPng = Readonly<{
	width: number;
	height: number;
	pixels: Uint8Array;
	channels: 3 | 4;
}>;

type EdgePaintInfo = Readonly<{
	clip: { x: number; y: number; width: number; height: number };
	strokeOpacity: number;
	strokeWidth: number;
	dash: string;
	markerEnd: string;
	inViewportPortal: boolean;
}>;

test.use({ screenshot: "only-on-failure", trace: "retain-on-failure" });

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function paeth(a: number, b: number, c: number): number {
	const p = a + b - c;
	const pa = Math.abs(p - a);
	const pb = Math.abs(p - b);
	const pc = Math.abs(p - c);
	if (pa <= pb && pa <= pc) return a;
	return pb <= pc ? b : c;
}

function decodeChromiumPng(buffer: Buffer): DecodedPng {
	expect(buffer.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
	let offset = 8;
	let width = 0;
	let height = 0;
	let bitDepth = 0;
	let colorType = -1;
	let interlace = -1;
	const idat: Buffer[] = [];

	while (offset + 12 <= buffer.length) {
		const length = buffer.readUInt32BE(offset);
		const type = buffer.toString("ascii", offset + 4, offset + 8);
		const dataStart = offset + 8;
		const dataEnd = dataStart + length;
		if (type === "IHDR") {
			width = buffer.readUInt32BE(dataStart);
			height = buffer.readUInt32BE(dataStart + 4);
			bitDepth = buffer[dataStart + 8] ?? 0;
			colorType = buffer[dataStart + 9] ?? -1;
			interlace = buffer[dataStart + 12] ?? -1;
		} else if (type === "IDAT") {
			idat.push(buffer.subarray(dataStart, dataEnd));
		} else if (type === "IEND") {
			break;
		}
		offset = dataEnd + 4;
	}

	expect(width).toBeGreaterThan(0);
	expect(height).toBeGreaterThan(0);
	expect(bitDepth).toBe(8);
	expect(interlace).toBe(0);
	expect([2, 6]).toContain(colorType);

	const channels = (colorType === 6 ? 4 : 3) as 3 | 4;
	const stride = width * channels;
	const raw = inflateSync(Buffer.concat(idat));
	const pixels = new Uint8Array(stride * height);
	let source = 0;

	for (let row = 0; row < height; row += 1) {
		const filter = raw[source] ?? 0;
		source += 1;
		const rowStart = row * stride;
		const previousStart = (row - 1) * stride;
		for (let index = 0; index < stride; index += 1) {
			const value = raw[source + index] ?? 0;
			const left = index >= channels ? pixels[rowStart + index - channels] ?? 0 : 0;
			const up = row > 0 ? pixels[previousStart + index] ?? 0 : 0;
			const upLeft =
				row > 0 && index >= channels
					? pixels[previousStart + index - channels] ?? 0
					: 0;
			let reconstructed = value;
			if (filter === 1) reconstructed = (value + left) & 0xff;
			else if (filter === 2) reconstructed = (value + up) & 0xff;
			else if (filter === 3) reconstructed = (value + Math.floor((left + up) / 2)) & 0xff;
			else if (filter === 4) reconstructed = (value + paeth(left, up, upLeft)) & 0xff;
			else if (filter !== 0) throw new Error(`Unsupported PNG filter ${filter}`);
			pixels[rowStart + index] = reconstructed;
		}
		source += stride;
	}

	return { width, height, pixels, channels };
}

function changedPixelCount(before: Buffer, after: Buffer): number {
	const left = decodeChromiumPng(before);
	const right = decodeChromiumPng(after);
	expect(right.width).toBe(left.width);
	expect(right.height).toBe(left.height);
	expect(right.channels).toBe(left.channels);

	let changed = 0;
	for (let index = 0; index < left.pixels.length; index += left.channels) {
		const delta =
			Math.abs((left.pixels[index] ?? 0) - (right.pixels[index] ?? 0)) +
			Math.abs((left.pixels[index + 1] ?? 0) - (right.pixels[index + 1] ?? 0)) +
			Math.abs((left.pixels[index + 2] ?? 0) - (right.pixels[index + 2] ?? 0));
		if (delta >= 18) changed += 1;
	}
	return changed;
}

async function closeWorkspaceOverlays(page: Page) {
	const navigationClose = page.getByRole("button", { name: "Recolher navegação do mundo" });
	if (await navigationClose.isVisible().catch(() => false)) await navigationClose.click();
	const inspectorClose = page.getByRole("button", { name: "Recolher painel de detalhes" });
	if (await inspectorClose.isVisible().catch(() => false)) await inspectorClose.click();
}

async function zoomToDetail(page: Page) {
	const canvas = page.getByTestId("world-canvas");
	const zoomIn = page.getByRole("button", { name: "Aumentar zoom" });
	for (let attempt = 0; attempt < 10; attempt += 1) {
		if ((await canvas.getAttribute("data-world-semantic-zoom")) === "detail") return;
		await zoomIn.click();
	}
	await expect(canvas).toHaveAttribute("data-world-semantic-zoom", "detail");
}

async function edgePaintInfo(page: Page, edgeId: string): Promise<EdgePaintInfo> {
	const edge = page.locator(`[data-world-edge="${edgeId}"]`);
	await expect(edge).toBeVisible();
	return edge.evaluate((element) => {
		const path = element as SVGPathElement;
		const rect = path.getBoundingClientRect();
		const style = getComputedStyle(path);
		const pad = 8;
		const left = Math.max(0, Math.floor(rect.left - pad));
		const top = Math.max(0, Math.floor(rect.top - pad));
		const right = Math.min(window.innerWidth, Math.ceil(rect.right + pad));
		const bottom = Math.min(window.innerHeight, Math.ceil(rect.bottom + pad));
		return {
			clip: {
				x: left,
				y: top,
				width: Math.max(1, right - left),
				height: Math.max(1, bottom - top),
			},
			strokeOpacity: Number.parseFloat(style.strokeOpacity),
			strokeWidth: Number.parseFloat(style.strokeWidth),
			dash: style.strokeDasharray,
			markerEnd: style.markerEnd,
			inViewportPortal: Boolean(path.closest(".react-flow__viewport-portal")),
		};
	});
}

async function setRelationPaintVisibility(page: Page, edgeId: string, visibility: "visible" | "hidden") {
	await page.evaluate(
		({ edgeId, visibility }) => {
			for (const selector of [
				`[data-world-edge="${edgeId}"]`,
				`[data-world-edge-halo="${edgeId}"]`,
				`[data-world-edge-motion="${edgeId}"]`,
			]) {
				for (const element of document.querySelectorAll<SVGElement>(selector)) {
					element.style.visibility = visibility;
				}
			}
		},
		{ edgeId, visibility },
	);
}

async function expectRelationRasterized(page: Page, edgeId: string, minimumChangedPixels = 6) {
	const info = await edgePaintInfo(page, edgeId);
	expect(info.strokeWidth).toBeGreaterThan(0);
	expect(info.strokeOpacity).toBeGreaterThan(0);
	expect(info.inViewportPortal).toBe(true);

	const painted = await page.screenshot({ clip: info.clip, animations: "disabled" });
	await setRelationPaintVisibility(page, edgeId, "hidden");
	const erased = await page.screenshot({ clip: info.clip, animations: "disabled" });
	await setRelationPaintVisibility(page, edgeId, "visible");

	expect(
		changedPixelCount(painted, erased),
		`${edgeId} must contribute visible rasterized pixels in Chromium`,
	).toBeGreaterThanOrEqual(minimumChangedPixels);
	return info;
}

async function expectDirectedMarkerRasterized(page: Page, edgeId: string) {
	const edge = page.locator(`[data-world-edge="${edgeId}"]`);
	const endpoint = await edge.evaluate((element) => {
		const path = element as SVGPathElement;
		const matrix = path.getScreenCTM();
		if (!matrix) throw new Error("World relation has no screen transform");
		const point = path
			.getPointAtLength(path.getTotalLength())
			.matrixTransform(matrix);
		return {
			x: Math.max(0, Math.min(window.innerWidth - 30, point.x - 15)),
			y: Math.max(0, Math.min(window.innerHeight - 30, point.y - 15)),
		};
	});
	const info = await edgePaintInfo(page, edgeId);
	expect(info.markerEnd).not.toBe("none");

	const clip = { x: endpoint.x, y: endpoint.y, width: 30, height: 30 };
	const withMarker = await page.screenshot({ clip, animations: "disabled" });
	await edge.evaluate((element) => {
		(element as SVGPathElement).style.setProperty("marker-end", "none");
	});
	const withoutMarker = await page.screenshot({ clip, animations: "disabled" });
	await edge.evaluate((element) => {
		(element as SVGPathElement).style.removeProperty("marker-end");
	});
	expect(
		changedPixelCount(withMarker, withoutMarker),
		`${edgeId} arrow marker must contribute visible pixels`,
	).toBeGreaterThanOrEqual(2);
}

test("public World rasterizes neutral solid, dashed and dotted relations through camera changes", async ({
	page,
}, testInfo) => {
	await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
	await page.setViewportSize({ width: 1366, height: 768 });
	await page.goto("/e2e-fixtures/world-edge-rasterization/public");
	await closeWorkspaceOverlays(page);
	await expect(page.locator('[data-world-node="stress-hub-a"]')).toBeVisible();
	await zoomToDetail(page);

	await expectRelationRasterized(page, "stress-hub-a-spoke-1");
	await expectRelationRasterized(page, "stress-hub-a-spoke-3");
	await expectRelationRasterized(page, "stress-hub-a-spoke-5");

	const canvas = page.getByTestId("world-canvas");
	const box = await canvas.boundingBox();
	expect(box).not.toBeNull();
	if (box) {
		await page.mouse.move(box.x + box.width * 0.52, box.y + box.height * 0.48);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.56, { steps: 5 });
		await page.mouse.up();
	}
	await expectRelationRasterized(page, "stress-hub-a-spoke-1");

	await page.setViewportSize({ width: 1920, height: 1080 });
	await expectRelationRasterized(page, "stress-hub-a-spoke-3");

	await page.reload();
	await closeWorkspaceOverlays(page);
	await zoomToDetail(page);
	await expectRelationRasterized(page, "stress-hub-a-spoke-5");

	const receipt = testInfo.outputPath("world-edge-raster-public-dark.png");
	await page.screenshot({ path: receipt, animations: "disabled" });
	await testInfo.attach("world-edge-raster-public-dark", { path: receipt, contentType: "image/png" });
});

test("Edit World rasterizes highlighted relations, arrows and survives workspace overlays", async ({
	page,
}, testInfo) => {
	await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
	await page.setViewportSize({ width: 1920, height: 1080 });
	await page.goto("/e2e-fixtures/world-edge-rasterization/edit");
	await closeWorkspaceOverlays(page);
	await zoomToDetail(page);

	await page.locator('[data-world-node="stress-hub-a"]').click();
	await expect(page.locator('[data-world-edge="stress-hub-a-spoke-1"]')).toHaveAttribute(
		"data-world-edge-active",
		"true",
	);
	await expect(page.locator('[data-world-edge-label="stress-hub-a-spoke-1"]')).toBeVisible();
	await expectRelationRasterized(page, "stress-hub-a-spoke-1", 10);
	await expectDirectedMarkerRasterized(page, "stress-hub-a-spoke-1");

	await page.getByRole("button", { name: "Explorar universo" }).click();
	await expectRelationRasterized(page, "stress-hub-a-spoke-1", 10);
	await page.getByRole("button", { name: "Recolher navegação do mundo" }).click();

	await page.getByRole("button", { name: "Abrir painel de detalhes" }).click();
	await expectRelationRasterized(page, "stress-hub-a-spoke-1", 10);
	await page.getByRole("button", { name: "Recolher painel de detalhes" }).click();
	await expectRelationRasterized(page, "stress-hub-a-spoke-1", 10);

	const receipt = testInfo.outputPath("world-edge-raster-edit-light.png");
	await page.screenshot({ path: receipt, animations: "disabled" });
	await testInfo.attach("world-edge-raster-edit-light", { path: receipt, contentType: "image/png" });
});
