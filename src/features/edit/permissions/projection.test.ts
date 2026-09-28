import { describe, expect, it } from "vitest";
import {
	projectPermissionsDirectory,
	type AssignmentRow,
} from "./projection";

const now = new Date("2026-09-28T12:00:00Z");
const actorProfileId = "11111111-1111-4111-8111-111111111111";
const targetProfileId = "22222222-2222-4222-8222-222222222222";
const managerRoleId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const readerRoleId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";

const assignment: AssignmentRow = {
	id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
	profile_id: targetProfileId,
	role_id: readerRoleId,
	scope_type: "campaign",
	scope_id: "yuhara-main",
	status: "active",
	starts_at: "2020-01-01T00:00:00Z",
	ends_at: null,
	updated_at: "2026-09-28T00:00:00Z",
};

const base = {
	campaign: { slug: "yuhara-main", name: "Sintética" },
	now,
	profiles: [
		{
			id: actorProfileId,
			display_name: "Admin sintético",
			auth_user_id: "auth-admin",
			discord_id: "discord-admin",
		},
		{
			id: targetProfileId,
			display_name: "Pessoa sintética",
			auth_user_id: "auth-target",
			discord_id: null,
		},
	],
	roles: [
		{
			id: managerRoleId,
			name: "Gestão sintética",
			slug: "synthetic-manager",
			description: "Administra permissões da campanha.",
			plane: "technical",
			is_system: true,
		},
		{
			id: readerRoleId,
			name: "Leitura sintética",
			slug: "synthetic-reader",
			description: "Lê transcrições.",
			plane: "narrative",
			is_system: true,
		},
	],
	permissions: [
		{
			role_id: managerRoleId,
			permission_action: "campaign.permissions.manage",
		},
		{
			role_id: readerRoleId,
			permission_action: "campaign.transcript.read",
		},
	],
	memberProfileIds: [actorProfileId, targetProfileId],
	revisions: [{ profile_id: targetProfileId, revision: 3 }],
	audits: [],
	actorProfileId,
	actorEffectiveActions: ["campaign.permissions.manage"],
};

describe("governed permissions projection", () => {
	it("includes campaign members without assignments so an admin can grant their first role", () => {
		const value = projectPermissionsDirectory({
			...base,
			assignments: [],
		});
		expect(value.people.map((person) => person.id)).toEqual([
			actorProfileId,
			targetProfileId,
		]);
		expect(value.people.find((person) => person.id === targetProfileId)).toMatchObject({
			revision: 3,
			campaignMember: true,
			roles: [],
			verifiedEditAccess: [],
		});
	});

	it("projects direct and inherited assignments while keeping project authority read-only", () => {
		const inherited: AssignmentRow = {
			...assignment,
			id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
			profile_id: actorProfileId,
			role_id: managerRoleId,
			scope_type: "project",
			scope_id: "tda",
		};
		const value = projectPermissionsDirectory({
			...base,
			assignments: [assignment, inherited],
		});
		const target = value.people.find((person) => person.id === targetProfileId);
		const actor = value.people.find((person) => person.id === actorProfileId);
		expect(target?.verifiedEditAccess.map((row) => row.action)).toEqual([
			"campaign.transcript.read",
		]);
		expect(actor?.verifiedEditAccess.map((row) => row.action)).toEqual([
			"campaign.permissions.manage",
		]);
		expect(actor?.roles[0]).toMatchObject({
			scopeType: "project",
			scopeId: "tda",
		});
	});

	it("marks project roles and roles above the actor delegation ceiling as nondelegable", () => {
		const projectRoleId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
		const sensitiveRoleId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
		const value = projectPermissionsDirectory({
			...base,
			assignments: [assignment],
			roles: [
				...base.roles,
				{
					id: projectRoleId,
					name: "Operação de projeto",
					slug: "project-operator",
					description: "Projeto.",
					plane: "technical",
					is_system: true,
				},
				{
					id: sensitiveRoleId,
					name: "Publisher",
					slug: "publisher",
					description: "Publica sessões.",
					plane: "narrative",
					is_system: true,
				},
			],
			permissions: [
				...base.permissions,
				{ role_id: projectRoleId, permission_action: "project.jobs.run" },
				{
					role_id: sensitiveRoleId,
					permission_action: "campaign.sessions.publish",
				},
			],
		});
		expect(
			value.roles.find((role) => role.id === projectRoleId),
		).toMatchObject({ delegable: false });
		expect(
			value.roles.find((role) => role.id === sensitiveRoleId),
		).toMatchObject({ delegable: false, sensitive: true });
	});

	it("allows sensitive delegation only when the actor has the same sensitive capability", () => {
		const publisherRoleId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
		const value = projectPermissionsDirectory({
			...base,
			assignments: [assignment],
			roles: [
				...base.roles,
				{
					id: publisherRoleId,
					name: "Publisher",
					slug: "publisher",
					description: "Publica sessões.",
					plane: "narrative",
					is_system: true,
				},
			],
			permissions: [
				...base.permissions,
				{
					role_id: publisherRoleId,
					permission_action: "campaign.sessions.publish",
				},
			],
			actorEffectiveActions: [
				"campaign.permissions.manage",
				"campaign.sessions.publish",
			],
		});
		expect(
			value.roles.find((role) => role.id === publisherRoleId),
		).toMatchObject({ delegable: true, sensitive: true });
	});

	it("maps audit IDs to human names without leaking identity payloads", () => {
		const value = projectPermissionsDirectory({
			...base,
			assignments: [assignment],
			audits: [
				{
					id: "audit-1",
					actor_id: actorProfileId,
					action: "permissions.role.grant",
					new_value: {
						operationId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
						targetProfileId,
						roleId: readerRoleId,
						reason: "synthetic",
						privateToken: "NEVER_LEAK",
					},
					created_at: now.toISOString(),
				},
			],
		});
		expect(value.history[0]).toMatchObject({
			operation: "grant",
			actorDisplayName: "Admin sintético",
			targetDisplayName: "Pessoa sintética",
			roleName: "Leitura sintética",
			reason: "synthetic",
		});
		expect(JSON.stringify(value)).not.toContain("NEVER_LEAK");
	});
});
