import { describe, expect, it } from "vitest";
import {
	campaignCreationHref,
	campaignManagementHref,
} from "./entrypoints";

describe("campaign management entrypoints", () => {
	it("keeps management canonical and carries a return intent explicitly", () => {
		expect(campaignManagementHref()).toBe("/edit/campanhas");
		expect(
			campaignManagementHref("/edit/yuhara-main/transcricoes?estado=published"),
		).toBe(
			"/edit/campanhas?next=%2Fedit%2Fyuhara-main%2Ftranscricoes%3Festado%3Dpublished",
		);
	});

	it("targets create as an action, never as a picker value", () => {
		expect(campaignCreationHref("/edit/processamento")).toBe(
			"/edit/campanhas?next=%2Fedit%2Fprocessamento#create-campaign",
		);
	});
});
