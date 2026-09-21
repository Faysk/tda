import { describe, expect, it } from "vitest";
import {
	hasLembraDateFilter,
	isWithinLembraDateRange,
	matchesLembraSearch,
	normalizeLembraSearchValue,
} from "./search";

const ITEM = {
	title: "Ruínas élficas",
	description: "Arcos antigos cobertos por árvores",
	author: "Thom",
	createdAt: "2026-09-21T14:30:00.000Z",
};

describe("Lembra search", () => {
	it("normalizes accents and punctuation", () => {
		expect(normalizeLembraSearchValue("Ruínas — ÉLFICAS!")).toBe("ruinas elficas");
	});

	it("searches title, description and author", () => {
		expect(matchesLembraSearch(ITEM, "ruinas")).toBe(true);
		expect(matchesLembraSearch(ITEM, "arvores")).toBe(true);
		expect(matchesLembraSearch(ITEM, "thom")).toBe(true);
		expect(matchesLembraSearch(ITEM, "taverna")).toBe(false);
	});

	it("supports mixed terms across different fields", () => {
		expect(matchesLembraSearch(ITEM, "thom arcos elficas")).toBe(true);
	});

	it("makes the publication date searchable", () => {
		expect(matchesLembraSearch(ITEM, "21/09/2026")).toBe(true);
		expect(matchesLembraSearch(ITEM, "setembro 2026")).toBe(true);
		expect(matchesLembraSearch(ITEM, "2026-09-21")).toBe(true);
	});

	it("filters by inclusive date boundaries", () => {
		expect(
			isWithinLembraDateRange(ITEM.createdAt, {
				from: "2026-09-21",
				to: "2026-09-21",
			}),
		).toBe(true);
		expect(
			isWithinLembraDateRange(ITEM.createdAt, {
				from: "2026-09-22",
				to: "",
			}),
		).toBe(false);
		expect(
			isWithinLembraDateRange(ITEM.createdAt, {
				from: "",
				to: "2026-09-20",
			}),
		).toBe(false);
	});

	it("detects whether the date filter is active", () => {
		expect(hasLembraDateFilter({ from: "", to: "" })).toBe(false);
		expect(hasLembraDateFilter({ from: "2026-09-01", to: "" })).toBe(true);
	});
});
