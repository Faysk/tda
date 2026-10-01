import { describe, expect, it } from "vitest";
import { isCampaignRegistrySchemaGap } from "./schema-compatibility";

describe("campaign registry schema compatibility", () => {
	it("recognizes PostgreSQL undefined-column errors from campaign SELECTs", () => {
		expect(
			isCampaignRegistrySchemaGap({
				code: "42703",
				message: 'column campaigns_1.lifecycle does not exist',
			}),
		).toBe(true);
		expect(
			isCampaignRegistrySchemaGap({
				code: "42703",
				message: 'column "campaigns"."public_slug" does not exist',
			}),
		).toBe(true);
	});

	it("recognizes PostgREST schema-cache misses for registry columns", () => {
		expect(
			isCampaignRegistrySchemaGap({
				code: "PGRST204",
				message:
					"Could not find the 'visibility' column of 'campaigns' in the schema cache",
			}),
		).toBe(true);
	});

	it("does not downgrade unrelated database or schema failures", () => {
		expect(
			isCampaignRegistrySchemaGap({
				code: "42501",
				message: "permission denied for table campaigns",
			}),
		).toBe(false);
		expect(
			isCampaignRegistrySchemaGap({
				code: "42703",
				message: "column sessions.visibility does not exist",
			}),
		).toBe(false);
		expect(
			isCampaignRegistrySchemaGap({
				code: "PGRST204",
				message:
					"Could not find the 'campaign_id' column of 'lembra_references' in the schema cache",
			}),
		).toBe(false);
	});
});
