import { describe, expect, it } from "vitest";
import { EDIT_CAPABILITIES, type EditAccessContext } from "./access/policy";
import {
	EDIT_ENTRY_PRIORITY,
	firstAuthorizedEditDestination,
} from "./navigation-entry";

const now = new Date("2026-09-28T00:00:00.000Z");

function context(actions: readonly string[]): EditAccessContext {
	return {
		authUserId: "auth-user",
		profileId: "profile-1",
		grants: actions.map((action) => ({
			action,
			scopeType: "campaign",
			scopeId: "yuhara-main",
			status: "active",
			startsAt: "2026-01-01T00:00:00.000Z",
			endsAt: null,
		})),
	};
}

describe("legacy /edit compatibility destination", () => {
	it("keeps the approved redirect priority explicit", () => {
		expect(EDIT_ENTRY_PRIORITY.map((entry) => entry.href)).toEqual([
			"/edit/sessoes",
			"/edit/processamento",
			"/mundo",
			"/edit/revisao",
			"/edit/yuhara-main/permissions",
		]);
	});

	it.each([
		[EDIT_CAPABILITIES.transcriptRead, "/edit/sessoes"],
		[EDIT_CAPABILITIES.localProcess, "/edit/processamento"],
		[EDIT_CAPABILITIES.worldLayoutEdit, "/mundo"],
		[EDIT_CAPABILITIES.reviewRead, "/edit/revisao"],
		[
			EDIT_CAPABILITIES.permissionsManage,
			"/edit/yuhara-main/permissions",
		],
	])("routes %s to %s", (capability, href) => {
		expect(firstAuthorizedEditDestination(context([capability]), now)).toBe(
			href,
		);
	});

	it("chooses the first authorized tool rather than grant insertion order", () => {
		expect(
			firstAuthorizedEditDestination(
				context([
					EDIT_CAPABILITIES.permissionsManage,
					EDIT_CAPABILITIES.worldLayoutEdit,
					EDIT_CAPABILITIES.transcriptRead,
				]),
				now,
			),
		).toBe("/edit/sessoes");
	});

	it("does not redirect unrelated grants into an unauthorized tool", () => {
		expect(
			firstAuthorizedEditDestination(
				context([EDIT_CAPABILITIES.contentEdit]),
				now,
			),
		).toBeNull();
	});

	it("fails closed when the profile is unresolved", () => {
		expect(
			firstAuthorizedEditDestination(
				{ ...context([EDIT_CAPABILITIES.transcriptRead]), profileId: null },
				now,
			),
		).toBeNull();
	});
});
