import { describe, expect, it } from "vitest";
import {
	formatArchiveDate,
	formatArchiveNumber,
	summarizeSessionArchive,
	type SessionArchiveItem,
} from "./archive";

function session(
	id: string,
	date: string,
	arc = "Arco",
): SessionArchiveItem {
	return {
		id,
		title: id,
		date,
		arc,
		summary: "Resumo",
	};
}

describe("public session archive summary", () => {
	it("formats public counts and compact dates", () => {
		expect(formatArchiveNumber(237073)).toBe("237.073");
		expect(formatArchiveDate("2026-09-01")).toBe("01 set 2026");
		expect(formatArchiveDate("2026-02-30")).toBe("—");
		expect(formatArchiveDate("")).toBe("—");
	});

	it("summarizes only fields already present in published session data", () => {
		const result = summarizeSessionArchive([
			session("latest", "2026-09-01", "Valcinzento"),
			session("middle", "", "valcinzento"),
			session("first", "2025-12-14", "Outro arco"),
		]);

		expect(result).toEqual({
			sessions: 3,
			arcs: 2,
			firstDate: "2025-12-14",
			latestDate: "2026-09-01",
		});
	});

	it("does not invent dates or arcs when the public fields are absent", () => {
		const result = summarizeSessionArchive([
			session("one", "not-a-date", ""),
			session("two", "", "   "),
		]);

		expect(result).toEqual({
			sessions: 2,
			arcs: 0,
			firstDate: "",
			latestDate: "",
		});
	});
});
