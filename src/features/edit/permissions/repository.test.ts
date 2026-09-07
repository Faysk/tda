import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/integrations/supabase/server", () => ({
	editDataClient: mocks.client,
}));
import { readPermissionsDirectory } from "./repository";

const assignment = {
	id: "grant",
	profile_id: "profile",
	role_id: "role",
	scope_type: "campaign",
	scope_id: "yuhara-main",
	status: "active",
	starts_at: "2020-01-01",
	ends_at: null,
};
function setup(override: Record<string, unknown> = {}) {
	const data: Record<string, unknown> = {
		campaigns: {
			data: { slug: "yuhara-main", name: "Sintética" },
			error: null,
		},
		role_assignments: { data: [assignment], error: null, count: 1 },
		profiles: {
			data: [
				{
					id: "profile",
					display_name: "Pessoa",
					auth_user_id: null,
					discord_id: null,
				},
			],
			error: null,
			count: 1,
		},
		role_definitions: {
			data: [{ id: "role", name: "Função", slug: "synthetic" }],
			error: null,
			count: 1,
		},
		role_permissions: {
			data: [
				{ role_id: "role", permission_action: "campaign.permissions.manage" },
			],
			error: null,
			count: 1,
		},
		...override,
	};
	const calls: { table: string; method: string; args: unknown[] }[] = [];
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
	});
	return calls;
}
beforeEach(() => {
	vi.clearAllMocks();
});
describe("permissions repository boundary", () => {
	it("filters campaign/project before resolving only those profiles and roles", async () => {
		const calls = setup();
		const result = await readPermissionsDirectory("yuhara-main");
		expect(result?.people).toHaveLength(1);
		expect(calls).toContainEqual({
			table: "role_assignments",
			method: "or",
			args: [
				"and(scope_type.eq.campaign,scope_id.eq.yuhara-main),and(scope_type.eq.project,scope_id.eq.tda)",
			],
		});
		expect(calls).toContainEqual({
			table: "profiles",
			method: "in",
			args: ["id", ["profile"]],
		});
		expect(calls).toContainEqual({
			table: "role_permissions",
			method: "in",
			args: ["role_id", ["role"]],
		});
		expect(
			calls
				.filter((call) => call.method === "select")
				.every(
					(call) =>
						!String(call.args[0]).includes("*") &&
						!/email|metadata|reason|assigned_by/u.test(String(call.args[0])),
				),
		).toBe(true);
	});
	it.each([
		"profiles",
		"role_definitions",
		"role_permissions",
		"role_assignments",
	])("fails closed on %s failure without partial DTO", async (table) => {
		setup({ [table]: { data: [], count: 0, error: { message: "PRIVATE" } } });
		await expect(readPermissionsDirectory("yuhara-main")).rejects.toThrow(
			"Permissions snapshot unavailable",
		);
	});
	it.each([null, 501, 2])(
		"does not claim a complete inventory if count is %s",
		async (count) => {
			setup({ role_assignments: { data: [assignment], error: null, count } });
			await expect(readPermissionsDirectory("yuhara-main")).rejects.toThrow(
				"capacity exceeded",
			);
		},
	);
	it("does not read global profiles when there are no scoped assignments", async () => {
		const calls = setup({
			role_assignments: { data: [], error: null, count: 0 },
		});
		expect((await readPermissionsDirectory("yuhara-main"))?.people).toEqual([]);
		expect(calls.some((call) => call.table === "profiles")).toBe(false);
	});
	it("fails if a referenced profile disappears during the read", async () => {
		setup({ profiles: { data: [], error: null, count: 0 } });
		await expect(readPermissionsDirectory("yuhara-main")).rejects.toThrow(
			"snapshot changed",
		);
	});
	it("distinguishes disabled connection from a missing campaign", async () => {
		mocks.client.mockReturnValue(null);
		await expect(readPermissionsDirectory("yuhara-main")).rejects.toThrow(
			"connection unavailable",
		);
		setup({ campaigns: { data: null, error: null } });
		expect(await readPermissionsDirectory("yuhara-main")).toBeNull();
	});
});
