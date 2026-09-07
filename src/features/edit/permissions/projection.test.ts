import { describe, expect, it } from "vitest";
import { projectPermissionsDirectory, type AssignmentRow } from "./projection";

const now = new Date("2026-09-07T12:00:00Z");
const assignment: AssignmentRow = {
	id: "assignment",
	profile_id: "profile",
	role_id: "role",
	scope_type: "campaign",
	scope_id: "yuhara-main",
	status: "active",
	starts_at: "2020-01-01",
	ends_at: null,
};
const input = {
	campaign: { slug: "yuhara-main", name: "Sintética" },
	now,
	profiles: [
		{
			id: "profile",
			display_name: "Pessoa sintética",
			auth_user_id: "PRIVATE_AUTH",
			discord_id: "PRIVATE_DISCORD",
			email: "PRIVATE_EMAIL",
			metadata: { secret: "PRIVATE_METADATA" },
		},
	],
	roles: [{ id: "role", name: "Função sintética", slug: "synthetic" }],
	permissions: [
		"campaign.permissions.manage",
		"project.jobs.run",
		"narrative.dm_notes.read",
		"campaign.unapproved.action",
	].map((permission_action) => ({ role_id: "role", permission_action })),
};
describe("scoped minimal permission projection", () => {
	it("does not present usable Edit access for a profile without an Auth link", () => {
		const value = projectPermissionsDirectory({
			...input,
			profiles: [{ ...input.profiles[0], auth_user_id: null }],
			assignments: [assignment],
		});
		expect(value.people[0].roles[0].active).toBe(true);
		expect(value.people[0].verifiedEditAccess).toEqual([]);
	});
	it("preserves every physical role action without inferring effectiveness from its prefix", () => {
		const value = projectPermissionsDirectory({
			...input,
			assignments: [assignment],
		});
		expect(value.people[0].roles[0].actions).toHaveLength(4);
		expect(value.people[0].verifiedEditAccess.map((row) => row.action)).toEqual(
			["campaign.permissions.manage"],
		);
		expect(value.people[0]).toMatchObject({
			authLinked: true,
			discordLinked: true,
		});
		for (const sensitive of [
			"PRIVATE_AUTH",
			"PRIVATE_DISCORD",
			"PRIVATE_EMAIL",
			"PRIVATE_METADATA",
			"auth_user_id",
			"discord_id",
		])
			expect(JSON.stringify(value)).not.toContain(sensitive);
	});
	it("preserves multiple direct and inherited origins for the same operation", () => {
		const value = projectPermissionsDirectory({
			...input,
			assignments: [
				assignment,
				{
					...assignment,
					id: "project",
					scope_type: "project",
					scope_id: "tda",
				},
			],
		});
		expect(value.people[0].verifiedEditAccess).toHaveLength(1);
		expect(
			value.people[0].verifiedEditAccess[0].origins.map(
				(origin) => origin.scopeType,
			),
		).toEqual(["campaign", "project"]);
	});
	it.each([
		{ scope_id: "other" },
		{ scope_type: "project", scope_id: "dnd-scribe" },
		{ scope_type: "project", scope_id: "project/tda" },
		{ scope_type: "session" },
	])("never projects cross-scope profiles or assignments: %j", (override) => {
		expect(
			projectPermissionsDirectory({
				...input,
				assignments: [{ ...assignment, ...override }],
			}).people,
		).toEqual([]);
	});
	it.each([
		{ status: "eligible" },
		{ status: "revoked" },
		{ status: "ended" },
		{ starts_at: "2099-01-01" },
		{ ends_at: now.toISOString() },
		{ starts_at: "invalid" },
	])(
		"preserves history but grants no effective Edit operation: %j",
		(override) => {
			const person = projectPermissionsDirectory({
				...input,
				assignments: [{ ...assignment, ...override }],
			}).people[0];
			expect(person.roles[0].active).toBe(false);
			expect(person.roles[0].actions).toHaveLength(4);
			expect(person.verifiedEditAccess).toEqual([]);
		},
	);
	it("fails when an assignment role cannot be resolved", () => {
		expect(() =>
			projectPermissionsDirectory({
				...input,
				roles: [],
				assignments: [assignment],
			}),
		).toThrow("Permissions role missing");
	});
});
