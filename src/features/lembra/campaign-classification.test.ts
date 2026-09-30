import { describe, expect, it } from "vitest";
import { isLembraCampaignRegistryUnavailable } from "./campaign-classification";

describe("Lembra campaign registry compatibility", () => {
	it("degrades only when first-class campaign columns are not yet exposed", () => {
		expect(
			isLembraCampaignRegistryUnavailable({
				code: "PGRST204",
				message:
					"Could not find the 'lifecycle' column of 'campaigns' in the schema cache",
			}),
		).toBe(true);
		expect(
			isLembraCampaignRegistryUnavailable({
				code: "PGRST204",
				message:
					"Could not find the 'visibility' column of 'campaigns' in the schema cache",
			}),
		).toBe(true);
	});

	it("does not hide unrelated database or schema failures", () => {
		expect(
			isLembraCampaignRegistryUnavailable({
				code: "42501",
				message: "permission denied for table campaigns",
			}),
		).toBe(false);
		expect(
			isLembraCampaignRegistryUnavailable({
				code: "PGRST204",
				message:
					"Could not find the 'campaign_id' column of 'lembra_references' in the schema cache",
			}),
		).toBe(false);
	});
});
