import { describe, expect, it } from "vitest";
import { EDIT_CAPABILITIES, type EditAccessContext } from "./access/policy";
import {
	EDIT_ENTRY_PRIORITY,
	firstAuthorizedEditDestination,
} from "./navigation-entry";

const now = new Date("2026-09-28T00:00:00.000Z");

function context(
	actions: readonly string[],
	scopeId = "yuhara-main",
): EditAccessContext {
	return {
		authUserId: "auth-user",
		profileId: "profile-1",
		grants: actions.map((action) => ({
			action,
			scopeType: "campaign",
			scopeId,
			status: "active",
			startsAt: "2026-01-01T00:00:00.000Z",
			endsAt: null,
		})),
	};
}

describe("legacy /edit compatibility destination", () => {
	it("keeps the historical redirect priority explicit and campaign-qualified", () => {
		expect(EDIT_ENTRY_PRIORITY.map((entry) => entry.href)).toEqual([
			"/edit/yuhara-main/sessoes",
			"/edit/processamento?campanha=yuhara-main",
			"/edit/yuhara-main/mundo",
			"/edit/revisao?campanha=yuhara-main",
			"/edit/yuhara-main/permissions",
		]);
	});

	it.each([
		[
			EDIT_CAPABILITIES.transcriptRead,
			"/edit/yuhara-main/sessoes",
		],
		[
			EDIT_CAPABILITIES.localProcess,
			"/edit/processamento?campanha=yuhara-main",
		],
		[EDIT_CAPABILITIES.worldLayoutEdit, "/edit/yuhara-main/mundo"],
		[EDIT_CAPABILITIES.reviewRead, "/edit/revisao?campanha=yuhara-main"],
		[
			EDIT_CAPABILITIES.permissionsManage,
			"/edit/yuhara-main/permissions",
		],
	])("routes the historical campaign capability %s to %s", (capability, href) => {
		expect(firstAuthorizedEditDestination(context([capability]), "yuhara-main", now)).toBe(
			href,
		);
	});

	it("uses campaign-safe destinations for a second campaign without legacy fallback", () => {
		const second = "antes-que-seja-tarde";
		expect(
			firstAuthorizedEditDestination(
				context([EDIT_CAPABILITIES.transcriptRead], second),
				second,
				now,
			),
		).toBe("/edit/antes-que-seja-tarde/sessoes");
		expect(
			firstAuthorizedEditDestination(
				context([EDIT_CAPABILITIES.permissionsManage], second),
				second,
				now,
			),
		).toBe("/edit/antes-que-seja-tarde/permissions");
		expect(
			firstAuthorizedEditDestination(
				context([EDIT_CAPABILITIES.localProcess], second),
				second,
				now,
			),
		).toBe("/edit/processamento?campanha=antes-que-seja-tarde");
		expect(
			firstAuthorizedEditDestination(
				context([EDIT_CAPABILITIES.worldLayoutEdit], second),
				second,
				now,
			),
		).toBe("/edit/antes-que-seja-tarde/mundo");
		expect(
			firstAuthorizedEditDestination(
				context([EDIT_CAPABILITIES.reviewRead], second),
				second,
				now,
			),
		).toBe("/edit/revisao?campanha=antes-que-seja-tarde");
	});

	it("routes project campaign managers to the registry before campaign-scoped tools", () => {
		const base = context([EDIT_CAPABILITIES.transcriptRead]);
		expect(
			firstAuthorizedEditDestination(
				{
					...base,
					grants: [
						...base.grants,
						{
							action: "project.campaigns.manage",
							scopeType: "project",
							scopeId: "tda",
							status: "active",
							startsAt: "2026-01-01T00:00:00.000Z",
							endsAt: null,
						},
					],
				},
				"yuhara-main",
				now,
			),
		).toBe("/edit/campanhas");
	});

	it("chooses the first authorized tool rather than grant insertion order", () => {
		expect(
			firstAuthorizedEditDestination(
				context([
					EDIT_CAPABILITIES.permissionsManage,
					EDIT_CAPABILITIES.worldLayoutEdit,
					EDIT_CAPABILITIES.transcriptRead,
				]),
				"yuhara-main",
				now,
			),
		).toBe("/edit/yuhara-main/sessoes");
	});

	it("does not redirect unrelated grants into an unauthorized tool", () => {
		expect(
			firstAuthorizedEditDestination(
				context([EDIT_CAPABILITIES.contentEdit]),
				"yuhara-main",
				now,
			),
		).toBeNull();
	});

	it("fails closed when the profile is unresolved", () => {
		expect(
			firstAuthorizedEditDestination(
				{ ...context([EDIT_CAPABILITIES.transcriptRead]), profileId: null },
				"yuhara-main",
				now,
			),
		).toBeNull();
	});
});
