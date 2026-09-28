import { describe, expect, it } from "vitest";
import { EDIT_CAPABILITIES, type EditAccessContext } from "./policy";
import { EDIT_ENTRYPOINTS, selectEditEntrypoint } from "./entrypoint";

const CAMPAIGN = "yuhara-main";

function contextWith(actions: readonly string[]): EditAccessContext {
	return {
		authUserId: "auth-user",
		profileId: "profile",
		grants: actions.map((action) => ({
			action,
			scopeType: "campaign",
			scopeId: CAMPAIGN,
			status: "active",
			startsAt: "2020-01-01T00:00:00.000Z",
			endsAt: null,
		})),
	};
}

describe("Edit compatibility entrypoint", () => {
	it("keeps an explicit stable priority independent of object iteration", () => {
		expect(
			EDIT_ENTRYPOINTS.map(({ href, capability }) => [href, capability]),
		).toEqual([
			["/edit/sessoes", EDIT_CAPABILITIES.transcriptRead],
			["/edit/processamento", EDIT_CAPABILITIES.localProcess],
			["/edit/mundo", EDIT_CAPABILITIES.worldLayoutEdit],
			["/edit/revisao", EDIT_CAPABILITIES.reviewRead],
			["/edit/:campaign/permissions", EDIT_CAPABILITIES.permissionsManage],
		]);
	});

	it("chooses the first authorized destination when several grants exist", () => {
		expect(
			selectEditEntrypoint(
				contextWith([
					EDIT_CAPABILITIES.permissionsManage,
					EDIT_CAPABILITIES.localProcess,
					EDIT_CAPABILITIES.transcriptRead,
				]),
				CAMPAIGN,
			),
		).toBe("/edit/sessoes");
	});

	it.each([
		[EDIT_CAPABILITIES.transcriptRead, "/edit/sessoes"],
		[EDIT_CAPABILITIES.localProcess, "/edit/processamento"],
		[EDIT_CAPABILITIES.worldLayoutEdit, "/edit/mundo"],
		[EDIT_CAPABILITIES.reviewRead, "/edit/revisao"],
		[EDIT_CAPABILITIES.permissionsManage, "/edit/yuhara-main/permissions"],
	] as const)("routes %s to %s", (capability, expected) => {
		expect(selectEditEntrypoint(contextWith([capability]), CAMPAIGN)).toBe(expected);
	});

	it("returns null when no visible Edit tool is authorized", () => {
		expect(
			selectEditEntrypoint(contextWith([EDIT_CAPABILITIES.contentEdit]), CAMPAIGN),
		).toBeNull();
	});
});
