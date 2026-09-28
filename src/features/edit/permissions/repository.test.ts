import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/integrations/supabase/server", () => ({
	editDataClient: mocks.client,
}));

import {
	persistPermissionMutation,
	readPermissionsDirectory,
} from "./repository";

const actorProfileId = "11111111-1111-4111-8111-111111111111";
const targetProfileId = "22222222-2222-4222-8222-222222222222";
const campaignId = "33333333-3333-4333-8333-333333333333";
const roleId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const assignmentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";

const assignment = {
	id: assignmentId,
	profile_id: targetProfileId,
	role_id: roleId,
	scope_type: "campaign",
	scope_id: "yuhara-main",
	status: "active",
	starts_at: "2020-01-01T00:00:00Z",
	ends_at: null,
	updated_at: "2026-09-28T00:00:00Z",
};

function setup(override: Record<string, unknown> = {}) {
	const data: Record<string, unknown> = {
		campaigns: {
			data: { id: campaignId, slug: "yuhara-main", name: "Sintética" },
			error: null,
		},
		role_assignments: { data: [assignment], error: null, count: 1 },
		campaign_members: {
			data: [
				{ profile_id: actorProfileId },
				{ profile_id: targetProfileId },
			],
			error: null,
			count: 2,
		},
		profiles: {
			data: [
				{
					id: actorProfileId,
					display_name: "Admin sintético",
					auth_user_id: "verified",
					discord_id: null,
				},
				{
					id: targetProfileId,
					display_name: "Pessoa sintética",
					auth_user_id: "target-auth",
					discord_id: null,
				},
			],
			error: null,
			count: 2,
		},
		role_definitions: {
			data: [
				{
					id: roleId,
					name: "Função",
					slug: "synthetic",
					description: "Sintética",
					plane: "narrative",
					is_system: true,
				},
			],
			error: null,
			count: 1,
		},
		role_permissions: {
			data: [
				{
					role_id: roleId,
					permission_action: "campaign.transcript.read",
				},
			],
			error: null,
			count: 1,
		},
		campaign_permission_revisions: {
			data: [{ profile_id: targetProfileId, revision: 2 }],
			error: null,
			count: 1,
		},
		audit_log: { data: [], error: null },
		...override,
	};

	const calls: { table: string; method: string; args: unknown[] }[] = [];
	const rpc = vi.fn().mockResolvedValue({
		data: { status: "updated", revision: 3, operationId: "operation" },
		error: null,
	});

	mocks.client.mockReturnValue({
		from: (table: string) => {
			const query = Promise.resolve(data[table]);
			for (const method of [
				"select",
				"eq",
				"in",
				"or",
				"order",
				"limit",
				"maybeSingle",
			])
				Object.assign(query, {
					[method]: (...args: unknown[]) => {
						calls.push({ table, method, args });
						return query;
					},
				});
			return query;
		},
		rpc,
	});

	return { calls, rpc };
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("permissions repository boundary", () => {
	it("loads only the authorized campaign/project assignment scope plus campaign members", async () => {
		const { calls } = setup();
		const result = await readPermissionsDirectory(
			"yuhara-main",
			actorProfileId,
			["campaign.permissions.manage"],
		);
		expect(result?.people.map((person) => person.displayName)).toEqual([
			"Admin sintético",
			"Pessoa sintética",
		]);
		expect(calls).toContainEqual({
			table: "role_assignments",
			method: "or",
			args: [
				"and(scope_type.eq.campaign,scope_id.eq.yuhara-main),and(scope_type.eq.project,scope_id.eq.tda)",
			],
		});
		expect(calls).toContainEqual({
			table: "campaign_members",
			method: "eq",
			args: ["campaign_id", campaignId],
		});
		expect(calls).toContainEqual({
			table: "profiles",
			method: "in",
			args: ["id", [targetProfileId, actorProfileId]],
		});
	});

	it.each([
		"profiles",
		"role_definitions",
		"role_permissions",
		"role_assignments",
		"campaign_members",
		"campaign_permission_revisions",
	])("fails closed on %s failure without a partial DTO", async (table) => {
		setup({ [table]: { data: [], count: 0, error: { message: "PRIVATE" } } });
		await expect(
			readPermissionsDirectory(
				"yuhara-main",
				actorProfileId,
				["campaign.permissions.manage"],
			),
		).rejects.toThrow();
	});

	it("allows a campaign member with no assignment to appear as a grant target", async () => {
		setup({
			role_assignments: { data: [], error: null, count: 0 },
			campaign_permission_revisions: { data: [], error: null, count: 0 },
		});
		const value = await readPermissionsDirectory(
			"yuhara-main",
			actorProfileId,
			["campaign.permissions.manage"],
		);
		expect(value?.people).toHaveLength(2);
		expect(
			value?.people.find((person) => person.id === targetProfileId),
		).toMatchObject({ roles: [], revision: 0, campaignMember: true });
	});

	it("fails if a required member/profile reference disappears during the read", async () => {
		setup({
			profiles: {
				data: [
					{
						id: actorProfileId,
						display_name: "Admin sintético",
						auth_user_id: "verified",
						discord_id: null,
					},
				],
				error: null,
				count: 1,
			},
		});
		await expect(
			readPermissionsDirectory(
				"yuhara-main",
				actorProfileId,
				["campaign.permissions.manage"],
			),
		).rejects.toThrow("snapshot changed");
	});

	it("distinguishes disabled connection from a missing campaign", async () => {
		mocks.client.mockReturnValue(null);
		await expect(
			readPermissionsDirectory(
				"yuhara-main",
				actorProfileId,
				["campaign.permissions.manage"],
			),
		).rejects.toThrow("connection unavailable");

		setup({ campaigns: { data: null, error: null } });
		expect(
			await readPermissionsDirectory(
				"yuhara-main",
				actorProfileId,
				["campaign.permissions.manage"],
			),
		).toBeNull();
	});

	it("maps the governed RPC result and never performs a blind retry", async () => {
		const { rpc } = setup();
		const result = await persistPermissionMutation({
			campaignSlug: "yuhara-main",
			actorProfileId,
			targetProfileId,
			expectedRevision: 2,
			changes: [{ operation: "grant", roleId }],
			operationId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
			reason: "synthetic",
			confirmSensitive: false,
			confirmSelfRevoke: false,
		});
		expect(result).toEqual({
			status: "updated",
			revision: 3,
			operationId: "operation",
		});
		expect(rpc).toHaveBeenCalledTimes(1);
		expect(rpc).toHaveBeenCalledWith(
			"manage_campaign_role_assignments",
			expect.objectContaining({
				p_campaign_slug: "yuhara-main",
				p_actor_profile_id: actorProfileId,
				p_target_profile_id: targetProfileId,
				p_expected_revision: 2,
			}),
		);
	});

	it("fails closed when the governed RPC cannot prove its result", async () => {
		const { rpc } = setup();
		rpc.mockResolvedValue({ data: null, error: { message: "PRIVATE" } });
		expect(
			await persistPermissionMutation({
				campaignSlug: "yuhara-main",
				actorProfileId,
				targetProfileId,
				expectedRevision: 2,
				changes: [{ operation: "revoke", roleId, assignmentId }],
				operationId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
				reason: null,
				confirmSensitive: false,
				confirmSelfRevoke: false,
			}),
		).toEqual({ status: "dependency_unavailable" });
		expect(rpc).toHaveBeenCalledTimes(1);
	});
});
