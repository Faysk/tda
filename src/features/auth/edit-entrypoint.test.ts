import { describe, expect, it } from "vitest";
import type { EditAccessContext, EditCapability } from "@/features/edit/access/policy";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import { resolveEditEntrypoint } from "./edit-entrypoint";

const campaign = "yuhara-main";

function context(...capabilities: EditCapability[]): EditAccessContext {
	return {
		authUserId: "synthetic-user",
		profileId: "synthetic-profile",
		grants: capabilities.map((action) => ({
			action,
			scopeType: "campaign",
			scopeId: campaign,
			status: "active",
			startsAt: "2020-01-01T00:00:00.000Z",
			endsAt: null,
		})),
	};
}

describe("legacy /edit compatibility entrypoint", () => {
	it("uses the explicit tool priority when several capabilities are available", () => {
		expect(
			resolveEditEntrypoint(
				context(
					EDIT_CAPABILITIES.permissionsManage,
					EDIT_CAPABILITIES.reviewRead,
					EDIT_CAPABILITIES.worldLayoutEdit,
					EDIT_CAPABILITIES.localProcess,
					EDIT_CAPABILITIES.transcriptRead,
				),
				campaign,
			),
		).toBe("/edit/sessoes");
	});

	it.each([
		[EDIT_CAPABILITIES.localProcess, "/edit/processamento"],
		[EDIT_CAPABILITIES.worldLayoutEdit, "/edit/mundo"],
		[EDIT_CAPABILITIES.reviewRead, "/edit/revisao"],
		[
			EDIT_CAPABILITIES.permissionsManage,
			"/edit/yuhara-main/permissions",
		],
	] as const)("routes %s to its real tool", (capability, expected) => {
		expect(resolveEditEntrypoint(context(capability), campaign)).toBe(expected);
	});

	it("returns no target when the account has no mapped tool capability", () => {
		expect(resolveEditEntrypoint(context(EDIT_CAPABILITIES.contentEdit), campaign)).toBeNull();
	});

	it("does not accept a grant from another campaign", () => {
		const wrongCampaign: EditAccessContext = {
			...context(EDIT_CAPABILITIES.transcriptRead),
			grants: [
				{
					...context(EDIT_CAPABILITIES.transcriptRead).grants[0],
					scopeId: "other-campaign",
				},
			],
		};
		expect(resolveEditEntrypoint(wrongCampaign, campaign)).toBeNull();
	});
});
