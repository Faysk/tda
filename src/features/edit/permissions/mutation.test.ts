import { describe, expect, it, vi } from "vitest";
import {
	EDIT_CAPABILITIES,
	type EditAccessContext,
} from "../access/policy";
import { mutatePermissions } from "./mutation";

const actorProfileId = "11111111-1111-4111-8111-111111111111";
const targetProfileId = "22222222-2222-4222-8222-222222222222";
const roleId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const assignmentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const operationId = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";

function dependencies(grants = [
	{
		action: EDIT_CAPABILITIES.permissionsManage,
		scopeType: "campaign",
		scopeId: "yuhara-main",
		status: "active",
		startsAt: "2020-01-01T00:00:00Z",
		endsAt: null,
	},
]) {
	const context: EditAccessContext = {
		authUserId: "verified",
		profileId: actorProfileId,
		grants,
	};
	return {
		resolveAccessContext: vi.fn().mockResolvedValue(context),
		persist: vi.fn().mockResolvedValue({
			status: "updated",
			revision: 4,
			operationId,
		}),
	};
}

const request = {
	authUserId: "verified",
	campaignSlug: "yuhara-main",
	targetProfileId,
	expectedRevision: 3,
	changes: [{ operation: "grant", roleId }],
	operationId,
	reason: "  Ajuste sintético  ",
	confirmSensitive: false,
	confirmSelfRevoke: false,
} as const;

describe("governed permission mutation", () => {
	it("denies anonymous and unauthorized actors before persistence", async () => {
		const anonymous = dependencies();
		expect(
			await mutatePermissions(
				{ ...request, authUserId: null },
				anonymous,
			),
		).toEqual({ ok: false, reason: "unauthenticated" });
		expect(anonymous.persist).not.toHaveBeenCalled();

		const denied = dependencies([]);
		expect(await mutatePermissions(request, denied)).toEqual({
			ok: false,
			reason: "forbidden",
		});
		expect(denied.persist).not.toHaveBeenCalled();
	});

	it("validates CAS identifiers and change shapes before access reads", async () => {
		for (const override of [
			{ expectedRevision: -1 },
			{ operationId: "not-uuid" },
			{ targetProfileId: "not-uuid" },
			{ changes: [] },
			{ changes: [{ operation: "grant", roleId }, { operation: "revoke", roleId, assignmentId }] },
			{ changes: [{ operation: "revoke", roleId }] },
		]) {
			const deps = dependencies();
			expect(
				await mutatePermissions(
					{ ...request, ...override },
					deps,
				),
			).toEqual({ ok: false, reason: "validation" });
			expect(deps.resolveAccessContext).not.toHaveBeenCalled();
			expect(deps.persist).not.toHaveBeenCalled();
		}
	});

	it("persists the verified actor profile, normalized reason and explicit CAS", async () => {
		const deps = dependencies();
		expect(await mutatePermissions(request, deps)).toEqual({
			ok: true,
			status: "updated",
			revision: 4,
			operationId,
		});
		expect(deps.persist).toHaveBeenCalledExactlyOnceWith({
			campaignSlug: "yuhara-main",
			actorProfileId,
			targetProfileId,
			expectedRevision: 3,
			changes: [{ operation: "grant", roleId }],
			operationId,
			reason: "Ajuste sintético",
			confirmSensitive: false,
			confirmSelfRevoke: false,
		});
	});

	it.each([
		["conflict", { revision: 9 }],
		["delegation_forbidden", {}],
		["last_admin", {}],
		["confirmation_required", { kind: "self_revoke" }],
		["duplicate", {}],
		["assignment_not_active", {}],
	] as const)("preserves persistence denial %s without retrying", async (status, extra) => {
		const deps = dependencies();
		deps.persist.mockResolvedValue({ status, ...extra });
		const result = await mutatePermissions(
			{
				...request,
				changes: [
					{ operation: "revoke", roleId, assignmentId },
				],
			},
			deps,
		);
		expect(result).toMatchObject({ ok: false, reason: status, ...extra });
		expect(deps.persist).toHaveBeenCalledTimes(1);
	});

	it("treats malformed persistence success as dependency unavailable", async () => {
		const deps = dependencies();
		deps.persist.mockResolvedValue({ status: "updated" });
		expect(await mutatePermissions(request, deps)).toEqual({
			ok: false,
			reason: "dependency_unavailable",
		});
	});
});
