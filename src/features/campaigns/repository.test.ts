import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ responses: [] as unknown[], calls: [] as Array<{table: string; filters: unknown[][]}> }));
vi.mock("server-only", () => ({}));
vi.mock("@/integrations/supabase/server", () => ({ publishedDataClient: () => ({ from: (table: string) => {
	const call = { table, filters: [] as unknown[][] }; m.calls.push(call);
	const q: Record<string, unknown> = {};
	for (const name of ["select", "eq", "order", "range", "maybeSingle", "limit", "or", "is", "gt", "not"])
		q[name] = (...args: unknown[]) => { call.filters.push([name, ...args]); return q; };
	q.then = (resolve: (value: unknown) => unknown) => Promise.resolve(m.responses.shift()).then(resolve);
	return q;
} }) }));
import { readPublicCampaignDirectory, resolvePublicCampaignRoute } from "./repository";
import { isCampaignRegistrySchemaGap } from "./schema-compatibility";
beforeEach(() => { m.responses=[]; m.calls=[]; vi.stubEnv("TDA_E2E_FIXTURES", "false"); });
it("restores the known legacy directory without enumerating other pre-registry campaigns", async () => {
 m.responses=[{error:{code:"42703",message:"column campaigns.public_slug does not exist"}},{data:{slug:"yuhara-main",description:"Synthetic"},error:null}];
 await expect(readPublicCampaignDirectory()).resolves.toEqual({ok:true,campaigns:[{routeKey:"cronicas-da-mesa",name:"Crônicas da Mesa",description:"Synthetic"}]});
 expect(m.calls[1].filters).toContainEqual(["eq","slug","yuhara-main"]);
});
it("resolves an active alias through its owner and checks public visibility again", async () => {
 m.responses=[{data:null,error:null},{data:{campaign_id:"owner-a"},error:null},{data:{slug:"campaign-a",public_slug:"renamed-a",name:"A",description:null},error:null}];
 await expect(resolvePublicCampaignRoute("old-a")).resolves.toEqual({ok:true,canonical:false,campaign:{technicalSlug:"campaign-a",routeKey:"renamed-a",name:"A",description:null}});
 expect(m.calls[1].table).toBe("campaign_public_route_aliases");
 expect(m.calls[1].filters).toContainEqual(["is","retired_at",null]);
 expect(m.calls[2].filters).toContainEqual(["eq","id","owner-a"]);
 expect(m.calls[2].filters).toContainEqual(["eq","visibility","public"]);
 expect(m.calls[2].filters).toContainEqual(["eq","lifecycle","active"]);
});
it("does not resolve aliases for private or archived owners", async () => {
 m.responses=[{data:null,error:null},{data:{campaign_id:"hidden"},error:null},{data:null,error:null}];
 await expect(resolvePublicCampaignRoute("hidden-alias")).resolves.toEqual({ok:false,reason:"not_found"});
});
it("distinguishes outages from missing pages without invoking legacy fallback", async () => {
 m.responses=[{data:null,error:{code:"42501",message:"permission denied for campaigns"}}];
 await expect(resolvePublicCampaignRoute("old-a")).resolves.toEqual({ok:false,reason:"dependency_unavailable"});
 expect(m.calls).toHaveLength(1);
});
it.each([
 {code:"42703",message:"column sessions.public_slug does not exist"},
 {code:"42703",message:"column campaigns.unrelated does not exist"},
 {code:"42501",message:"campaigns.public_slug"},
 {code:"PGRST200",message:"campaigns.public_slug"},
])("does not interpret unrelated errors as an unapplied registry", (error) => {
 expect(isCampaignRegistrySchemaGap(error)).toBe(false);
});
