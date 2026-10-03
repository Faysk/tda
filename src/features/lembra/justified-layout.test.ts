import { describe, expect, it } from "vitest";
import type { LembraReference } from "./model";
import {
	buildLembraJustifiedRows,
	LEMBRA_FALLBACK_ASPECT_RATIO,
	LEMBRA_MAX_LAYOUT_ASPECT_RATIO,
	LEMBRA_MIN_LAYOUT_ASPECT_RATIO,
	lembraLayoutAspectRatio,
} from "./justified-layout";

function reference(
	id: string,
	width?: number,
	height?: number,
): LembraReference {
	return {
		id,
		title: id,
		description: "",
		author: "Teste",
		authorAuthUserId: "test-user",
		createdAt: "2026-09-27T12:00:00.000Z",
		updatedAt: "2026-09-27T12:00:00.000Z",
		imageUrl: "/image",
		width,
		height,
		mine: true,
		campaign: null,
		campaignRestricted: false,
	};
}

describe("Lembra justified layout", () => {
	it("normalizes invalid and extreme aspect ratios without deforming source metadata", () => {
		expect(lembraLayoutAspectRatio(reference("missing"))).toBe(
			LEMBRA_FALLBACK_ASPECT_RATIO,
		);
		expect(lembraLayoutAspectRatio(reference("invalid", 0, 100))).toBe(
			LEMBRA_FALLBACK_ASPECT_RATIO,
		);
		expect(lembraLayoutAspectRatio(reference("portrait", 100, 2000))).toBe(
			LEMBRA_MIN_LAYOUT_ASPECT_RATIO,
		);
		expect(lembraLayoutAspectRatio(reference("panorama", 4000, 100))).toBe(
			LEMBRA_MAX_LAYOUT_ASPECT_RATIO,
		);
	});

	it("fills completed rows while keeping every item at one media height", () => {
		const items = [
			reference("one", 4, 3),
			reference("two", 4, 3),
			reference("three", 4, 3),
			reference("four", 4, 3),
			reference("five", 4, 3),
		];
		const layout = buildLembraJustifiedRows(items, 1200, {
			gap: 12,
			targetRowHeight: 240,
		});
		const completed = layout.rows.find((row) => row.justified);
		expect(completed).toBeDefined();
		if (!completed) return;

		const occupied =
			completed.items.reduce((sum, item) => sum + item.width, 0) +
			layout.gap * (completed.items.length - 1);
		expect(Math.abs(occupied - 1200)).toBeLessThan(0.01);
		expect(
			new Set(completed.items.map((item) => item.height.toFixed(4))).size,
		).toBe(1);
	});

	it("keeps a sparse final row left-sized instead of stretching it to the container", () => {
		const items = [
			reference("one", 4, 3),
			reference("two", 4, 3),
			reference("three", 4, 3),
			reference("four", 4, 3),
			reference("five", 4, 3),
		];
		const layout = buildLembraJustifiedRows(items, 1200, {
			gap: 12,
			targetRowHeight: 240,
		});
		const last = layout.rows.at(-1);
		expect(last?.justified).toBe(false);
		expect(last?.items).toHaveLength(1);
		expect(last?.items[0].width).toBeLessThan(400);
	});

	it("preserves source ordering across mixed landscape, square and portrait items", () => {
		const items = [
			reference("landscape", 16, 9),
			reference("square", 1, 1),
			reference("portrait", 2, 3),
			reference("classic", 4, 3),
			reference("second-square", 1, 1),
		];
		const layout = buildLembraJustifiedRows(items, 1100, {
			gap: 12,
			targetRowHeight: 220,
		});
		expect(
			layout.rows.flatMap((row) => row.items.map((item) => item.reference.id)),
		).toEqual(items.map((item) => item.id));
	});

	it("uses one stable card per row at narrow mobile widths", () => {
		const items = [
			reference("landscape", 16, 9),
			reference("portrait", 2, 3),
			reference("panorama", 10, 1),
		];
		const layout = buildLembraJustifiedRows(items, 320, {
			gap: 10,
			targetRowHeight: 176,
		});
		expect(layout.rows).toHaveLength(items.length);
		for (const row of layout.rows) {
			expect(row.justified).toBe(false);
			expect(row.items).toHaveLength(1);
			expect(row.items[0].width).toBe(320);
			expect(row.items[0].height).toBeGreaterThan(0);
		}
	});

	it("never overflows the container on the final row", () => {
		const items = [
			reference("a", 16, 9),
			reference("b", 16, 9),
			reference("c", 16, 9),
		];
		const layout = buildLembraJustifiedRows(items, 640, {
			gap: 10,
			targetRowHeight: 190,
		});
		for (const row of layout.rows) {
			const occupied =
				row.items.reduce((sum, item) => sum + item.width, 0) +
				layout.gap * (row.items.length - 1);
			expect(occupied).toBeLessThanOrEqual(640.01);
		}
	});
});
