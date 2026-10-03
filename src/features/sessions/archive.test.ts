import { describe, expect, it } from "vitest";
import {
	formatArchiveDate,
	formatArchiveNumber,
	listSessionArcOptions,
	normalizeSessionArcIdentity,
	summarizeSessionArchive,
	type SessionArchiveItem,
} from "./archive";

function session(
	id: string,
	date: string,
	arc = "Arco",
	campaignSlug = "campaign-a",
): SessionArchiveItem {
	return {
		id,
		campaignId: campaignSlug,
		campaignSlug,
		campaignName: campaignSlug === "campaign-a" ? "Campaign A" : "Campaign B",
		campaignTechnicalSlug: campaignSlug,
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
	});

	it("normalizes arc identity with trim, case and canonical Unicode only", () => {
		const composed = " Valcinzento e o Coração-Raiz ";
		const decomposed = "VALCINZENTO E O CORAÇÃO-RAIZ";
		expect(normalizeSessionArcIdentity(composed)).toBe(
			normalizeSessionArcIdentity(decomposed),
		);
		expect(normalizeSessionArcIdentity(composed)).toBe(
			"valcinzento e o coração-raiz",
		);
		expect(normalizeSessionArcIdentity("Thalindra")).not.toBe(
			normalizeSessionArcIdentity("Talindra"),
		);
	});

	it("uses the same normalized identity for scoped summary and filter options", () => {
		const sessions = [
			session("a","2026-09-04","VALCINZENTO E O CORAÇÃO-RAIZ"),
			session("b","2026-09-03","Valcinzento e o Coração-Raiz"),
			session("c","2026-09-02"," Valcinzento e o Coração-Raiz "),
			session("d","2026-09-01","Valcinzento e o Coração-Raiz"),
		];

		const options = listSessionArcOptions(sessions);
		expect(options).toHaveLength(1);
		expect(options[0]).toMatchObject({
			label: "VALCINZENTO E O CORAÇÃO-RAIZ",
			normalizedArc: "valcinzento e o coração-raiz",
			campaignSlug: "campaign-a",
		});
		expect(summarizeSessionArchive(sessions).arcs).toBe(options.length);
	});

	it("keeps aggregate arc identity qualified by campaign", () => {
		const a = session("a", "2026-09-01", "Mesmo arco", "campaign-a");
		const b = session("b", "2026-09-02", "mesmo arco", "campaign-b");
		const options = listSessionArcOptions([a, b], {
			qualifyByCampaign: true,
		});

		expect(summarizeSessionArchive([a, b]).arcs).toBe(1);
		expect(
			summarizeSessionArchive([a, b], { qualifyArcsByCampaign: true }).arcs,
		).toBe(2);
		expect(options).toHaveLength(2);
		expect(new Set(options.map((option) => option.identity)).size).toBe(2);
	});

	it("summarizes dates without inventing absent values", () => {
		const result = summarizeSessionArchive([
			session("latest", "2026-09-01", "Valcinzento"),
			session("first", "2025-12-14", "Outro arco"),
		]);
		expect(result).toEqual({
			sessions: 2,
			arcs: 2,
			firstDate: "2025-12-14",
			latestDate: "2026-09-01",
		});
	});
});
