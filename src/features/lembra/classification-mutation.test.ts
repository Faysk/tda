import { describe, expect, it } from "vitest";
import {
	concealUndiscoverableLembraReclassification,
	lembraCampaignColumnPatch,
} from "./classification-mutation";

describe("Lembra classification mutation persistence", () => {
	it("preserves an existing hidden classification by omitting campaign_id", () => {
		expect(lembraCampaignColumnPatch({ kind: "preserve" })).toEqual({});
		expect(
			Object.hasOwn(lembraCampaignColumnPatch({ kind: "preserve" }), "campaign_id"),
		).toBe(false);
	});

	it("distinguishes explicit clear from explicit set", () => {
		expect(lembraCampaignColumnPatch({ kind: "clear" })).toEqual({
			campaign_id: null,
		});
		expect(
			lembraCampaignColumnPatch({
				kind: "set",
				campaignId: "22222222-2222-4222-8222-222222222222",
			}),
		).toEqual({
			campaign_id: "22222222-2222-4222-8222-222222222222",
		});
	});

	it("turns unauthorized clear into an indistinguishable preserve no-op", () => {
		expect(
			concealUndiscoverableLembraReclassification(
				{ kind: "clear" },
				"22222222-2222-4222-8222-222222222222",
				false,
			),
		).toEqual({ kind: "preserve" });
		expect(
			concealUndiscoverableLembraReclassification(
				{ kind: "clear" },
				"22222222-2222-4222-8222-222222222222",
				true,
			),
		).toEqual({ kind: "clear" });
		expect(
			concealUndiscoverableLembraReclassification({ kind: "clear" }, null, false),
		).toEqual({ kind: "clear" });
		expect(
			concealUndiscoverableLembraReclassification(
				{
					kind: "set",
					campaignId: "11111111-1111-4111-8111-111111111111",
				},
				"22222222-2222-4222-8222-222222222222",
				false,
			),
		).toEqual({ kind: "preserve" });
	});
});
