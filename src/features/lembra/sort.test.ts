import { describe, expect, it } from "vitest";
import { sortLembraReferences } from "./sort";

const ITEMS = [
	{
		id: "b",
		title: "Templo",
		author: "Zoe",
		createdAt: "2026-09-20T12:00:00.000Z",
	},
	{
		id: "a",
		title: "Árvore antiga",
		author: "Ana",
		createdAt: "2026-09-21T12:00:00.000Z",
	},
	{
		id: "c",
		title: "Ruínas",
		author: "Ana",
		createdAt: "2026-09-19T12:00:00.000Z",
	},
];

describe("Lembra sorting", () => {
	it("sorts newest and oldest by publication time", () => {
		expect(sortLembraReferences(ITEMS, "newest").map((item) => item.id)).toEqual([
			"a",
			"b",
			"c",
		]);
		expect(sortLembraReferences(ITEMS, "oldest").map((item) => item.id)).toEqual([
			"c",
			"b",
			"a",
		]);
	});

	it("sorts titles accent-insensitively", () => {
		expect(sortLembraReferences(ITEMS, "title").map((item) => item.id)).toEqual([
			"a",
			"c",
			"b",
		]);
	});

	it("sorts author first and keeps newest first within the author", () => {
		expect(sortLembraReferences(ITEMS, "author").map((item) => item.id)).toEqual([
			"a",
			"c",
			"b",
		]);
	});

	it("does not mutate the source array", () => {
		const copy = [...ITEMS];
		sortLembraReferences(ITEMS, "title");
		expect(ITEMS).toEqual(copy);
	});
});
