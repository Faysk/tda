import { describe, expect, it } from "vitest";
import { formatArchiveDate, formatArchiveNumber, summarizeSessionArchive, type SessionArchiveItem } from "./archive";

function session(id:string,date:string,arc="Arco",campaignSlug="campaign-a"):SessionArchiveItem{
	return {id,campaignId:campaignSlug,campaignSlug,campaignName:campaignSlug==="campaign-a"?"Campaign A":"Campaign B",campaignTechnicalSlug:campaignSlug,title:id,date,arc,summary:"Resumo"};
}

describe("public session archive summary",()=>{
	it("formats public counts and compact dates",()=>{
		expect(formatArchiveNumber(237073)).toBe("237.073");
		expect(formatArchiveDate("2026-09-01")).toBe("01 set 2026");
		expect(formatArchiveDate("2026-02-30")).toBe("—");
	});
	it("keeps scoped arcs simple and aggregate arcs campaign-qualified",()=>{
		const a=session("a","2026-09-01","Mesmo arco","campaign-a");
		const b=session("b","2026-09-02","Mesmo arco","campaign-b");
		expect(summarizeSessionArchive([a,b]).arcs).toBe(1);
		expect(summarizeSessionArchive([a,b],{qualifyArcsByCampaign:true}).arcs).toBe(2);
	});
	it("summarizes dates without inventing absent values",()=>{
		const result=summarizeSessionArchive([session("latest","2026-09-01","Valcinzento"),session("first","2025-12-14","Outro arco")]);
		expect(result).toEqual({sessions:2,arcs:2,firstDate:"2025-12-14",latestDate:"2026-09-01"});
	});
});
