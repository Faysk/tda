import { describe, expect, it } from "vitest";
import type { EditAccessContext, EditGrant } from "@/features/edit/access/policy";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import {
	EDIT_ENTRY_DESTINATIONS,
	resolveEditCompatibilityTarget,
	resolveEditEntryDestination,
} from "./navigation";

function grant(action: string): EditGrant {
	return {
		action,
		scopeType: "campaign",
		scopeId: "yuhara-main",
		status: "active",
		startsAt: "2020-01-01T00:00:00.000Z",
		endsAt: null,
	};
}

function context(
	actions: readonly string[],
	profileId: string | null = "profile-1",
): EditAccessContext {
	return {
		authUserId: "auth-user-private",
		profileId,
		grants: actions.map(grant),
	};
}

describe("Edit compatibility entrypoint", () => {
	it("keeps an explicit stable priority independent of grant order", () => {
		expect(EDIT_ENTRY_DESTINATIONS.map((item) => item.href)).toEqual([
			"/edit/sessoes",
			"/edit/processamento",
			"/edit/mundo",
			"/edit/revisao",
			"/edit/yuhara-main/permissions",
		]);

		expect(
			resolveEditEntryDestination(
				context([
					EDIT_CAPABILITIES.permissionsManage,
					EDIT_CAPABILITIES.localProcess,
					EDIT_CAPABILITIES.transcriptRead,
				]),
			),
		).toBe("/edit/sessoes");
	});

	it.each([
		[EDIT_CAPABILITIES.transcriptRead, "/edit/sessoes"],
		[EDIT_CAPABILITIES.localProcess, "/edit/processamento"],
		[EDIT_CAPABILITIES.worldLayoutEdit, "/edit/mundo"],
		[EDIT_CAPABILITIES.reviewRead, "/edit/revisao"],
		[
			EDIT_CAPABILITIES.permissionsManage,
			"/edit/yuhara-main/permissions",
		],
	] as const)("maps %s to %s", (capability, href) => {
		expect(resolveEditEntryDestination(context([capability]))).toBe(href);
	});

	it("returns null when no supported tool is authorized", () => {
		expect(resolveEditEntryDestination(context([]))).toBeNull();
		expect(
			resolveEditEntryDestination(context([EDIT_CAPABILITIES.contentEdit])),
		).toBeNull();
		expect(
			resolveEditEntryDestination(
				context([EDIT_CAPABILITIES.transcriptRead], null),
			),
		).toBeNull();
	});

	it("keeps anonymous, unavailable and denied recovery distinct", () => {
		expect(
			resolveEditCompatibilityTarget({ state: "anonymous", context: null }),
		).toBe("/entrar?next=%2Fedit");
		expect(
			resolveEditCompatibilityTarget({ state: "unavailable", context: null }),
		).toBe("/conta?acesso=indisponivel");
		expect(
			resolveEditCompatibilityTarget({
				state: "authenticated_unlinked",
				context: context([], null),
			}),
		).toBe("/conta?acesso=negado");
		expect(
			resolveEditCompatibilityTarget({
				state: "authenticated_linked_no_grants",
				context: context([]),
			}),
		).toBe("/conta?acesso=negado");
	});

	it("redirects linked users to the first supported authorized tool", () => {
		expect(
			resolveEditCompatibilityTarget({
				state: "authenticated_linked",
				context: context([
					EDIT_CAPABILITIES.worldLayoutEdit,
					EDIT_CAPABILITIES.localProcess,
				]),
			}),
		).toBe("/edit/processamento");
		expect(
			resolveEditCompatibilityTarget({
				state: "authenticated_linked",
				context: context([EDIT_CAPABILITIES.contentEdit]),
			}),
		).toBe("/conta?acesso=negado");
	});
});
