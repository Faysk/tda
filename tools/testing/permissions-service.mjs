// Synthetic HTTP fixture for the production app's real Auth + PostgREST clients.
// Never imported by src/ or deployed. No production credentials or real identities.
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

const IDS = {
	campaign: "10000000-0000-4000-8000-000000000001",
	emptyCampaign: "10000000-0000-4000-8000-000000000002",
	manager: "11111111-1111-4111-8111-111111111111",
	reader: "22222222-2222-4222-8222-222222222222",
	project: "33333333-3333-4333-8333-333333333333",
	expired: "44444444-4444-4444-8444-444444444444",
	foreign: "55555555-5555-4555-8555-555555555555",
	technical: "66666666-6666-4666-8666-666666666666",
	conductor: "77777777-7777-4777-8777-777777777777",
	member: "88888888-8888-4888-8888-888888888888",
	managerRole: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
	readerRole: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
	technicalRole: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
	conductorRole: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
	editorRole: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5",
};

const roles = [
	{
		id: IDS.managerRole,
		name: "Gestão sintética",
		slug: "synthetic-manager",
		description: "Administra permissões da campanha.",
		plane: "technical",
		is_system: true,
	},
	{
		id: IDS.readerRole,
		name: "Leitura sintética",
		slug: "synthetic-reader",
		description: "Lê transcrições completas.",
		plane: "narrative",
		is_system: true,
	},
	{
		id: IDS.technicalRole,
		name: "Operação técnica",
		slug: "synthetic-technical",
		description: "Opera jobs de projeto.",
		plane: "technical",
		is_system: true,
	},
	{
		id: IDS.conductorRole,
		name: "Condução do Mundo",
		slug: "synthetic-world-conductor",
		description: "Edita a composição do Mundo.",
		plane: "narrative",
		is_system: true,
	},
	{
		id: IDS.editorRole,
		name: "Editor e Publisher",
		slug: "synthetic-editor",
		description: "Edita conteúdo e publica sessões.",
		plane: "narrative",
		is_system: true,
	},
];

const permissions = [
	{
		role_id: IDS.managerRole,
		permission_action: "campaign.permissions.manage",
	},
	{ role_id: IDS.readerRole, permission_action: "campaign.transcript.read" },
	{ role_id: IDS.technicalRole, permission_action: "project.jobs.run" },
	{
		role_id: IDS.conductorRole,
		permission_action: "campaign.world.layout.edit",
	},
	{ role_id: IDS.editorRole, permission_action: "campaign.content.edit" },
	{
		role_id: IDS.editorRole,
		permission_action: "campaign.sessions.publish",
	},
];

const profiles = [
	["manager", IDS.manager],
	["reader", IDS.reader],
	["project", IDS.project],
	["expired", IDS.expired],
	["foreign", IDS.foreign],
	["technical", IDS.technical],
	["conductor", IDS.conductor],
	["member", IDS.member],
].map(([authId, id]) => ({
	id,
	display_name: `Pessoa ${authId}`,
	auth_user_id: authId,
	discord_id: `PRIVATE_DISCORD_${authId}`,
	email: "PRIVATE_EMAIL",
	metadata: { secret: "PRIVATE_METADATA" },
}));

const campaignMembers = [
	IDS.manager,
	IDS.reader,
	IDS.project,
	IDS.expired,
	IDS.conductor,
	IDS.member,
].map((profile_id, index) => ({
	id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
	campaign_id: IDS.campaign,
	profile_id,
	role: "synthetic",
	created_at: "2026-09-01T00:00:00Z",
}));

function baseAssignments({ withoutProjectAdmin = false } = {}) {
	const assignments = [
		{
			id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
			profile_id: IDS.manager,
			role_id: IDS.managerRole,
			scope_type: "campaign",
			scope_id: "yuhara-main",
			status: "active",
			starts_at: "2020-01-01T00:00:00Z",
			ends_at: null,
			assigned_by: null,
			revoked_by: null,
			reason: null,
			metadata: {},
			created_at: "2020-01-01T00:00:00Z",
			updated_at: "2026-09-28T00:00:00Z",
		},
		{
			id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
			profile_id: IDS.reader,
			role_id: IDS.readerRole,
			scope_type: "campaign",
			scope_id: "yuhara-main",
			status: "active",
			starts_at: "2020-01-01T00:00:00Z",
			ends_at: null,
			assigned_by: null,
			revoked_by: null,
			reason: null,
			metadata: {},
			created_at: "2020-01-01T00:00:00Z",
			updated_at: "2026-09-28T00:00:00Z",
		},
		{
			id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4",
			profile_id: IDS.expired,
			role_id: IDS.managerRole,
			scope_type: "campaign",
			scope_id: "yuhara-main",
			status: "revoked",
			starts_at: "2020-01-01T00:00:00Z",
			ends_at: "2025-01-01T00:00:00Z",
			assigned_by: null,
			revoked_by: IDS.manager,
			reason: "synthetic historical revoke",
			metadata: {},
			created_at: "2020-01-01T00:00:00Z",
			updated_at: "2025-01-01T00:00:00Z",
		},
		{
			id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5",
			profile_id: IDS.foreign,
			role_id: IDS.managerRole,
			scope_type: "campaign",
			scope_id: "other-campaign",
			status: "active",
			starts_at: "2020-01-01T00:00:00Z",
			ends_at: null,
			assigned_by: null,
			revoked_by: null,
			reason: null,
			metadata: {},
			created_at: "2020-01-01T00:00:00Z",
			updated_at: "2026-09-28T00:00:00Z",
		},
		{
			id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb6",
			profile_id: IDS.technical,
			role_id: IDS.technicalRole,
			scope_type: "project",
			scope_id: "tda",
			status: "active",
			starts_at: "2020-01-01T00:00:00Z",
			ends_at: null,
			assigned_by: null,
			revoked_by: null,
			reason: null,
			metadata: {},
			created_at: "2020-01-01T00:00:00Z",
			updated_at: "2026-09-28T00:00:00Z",
		},
		{
			id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb7",
			profile_id: IDS.conductor,
			role_id: IDS.conductorRole,
			scope_type: "campaign",
			scope_id: "yuhara-main",
			status: "active",
			starts_at: "2020-01-01T00:00:00Z",
			ends_at: null,
			assigned_by: null,
			revoked_by: null,
			reason: null,
			metadata: {},
			created_at: "2020-01-01T00:00:00Z",
			updated_at: "2026-09-28T00:00:00Z",
		},
	];
	if (!withoutProjectAdmin)
		assignments.push({
			id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3",
			profile_id: IDS.project,
			role_id: IDS.managerRole,
			scope_type: "project",
			scope_id: "tda",
			status: "active",
			starts_at: "2020-01-01T00:00:00Z",
			ends_at: null,
			assigned_by: null,
			revoked_by: null,
			reason: null,
			metadata: {},
			created_at: "2020-01-01T00:00:00Z",
			updated_at: "2026-09-28T00:00:00Z",
		});
	return assignments;
}

let state;
const requests = [];

function resetState(options = {}) {
	state = {
		assignments: baseAssignments(options),
		revisions: new Map(),
		audits: [],
	};
}

resetState();

const roleActions = (roleId) =>
	permissions
		.filter((permission) => permission.role_id === roleId)
		.map((permission) => permission.permission_action);

const isActive = (assignment) =>
	assignment.status === "active" &&
	Date.parse(assignment.starts_at) <= Date.now() &&
	(!assignment.ends_at || Date.parse(assignment.ends_at) > Date.now());

function effectiveActions(profileId, campaignSlug) {
	return [
		...new Set(
			state.assignments
				.filter(
					(assignment) =>
						assignment.profile_id === profileId &&
						isActive(assignment) &&
						((assignment.scope_type === "campaign" &&
							assignment.scope_id === campaignSlug) ||
							(assignment.scope_type === "project" &&
								assignment.scope_id === "tda")),
				)
				.flatMap((assignment) => roleActions(assignment.role_id)),
		),
	];
}

function parseBody(request) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		request.on("data", (chunk) => chunks.push(chunk));
		request.on("end", () => {
			try {
				resolve(
					chunks.length
						? JSON.parse(Buffer.concat(chunks).toString("utf8"))
						: {},
				);
			} catch (error) {
				reject(error);
			}
		});
		request.on("error", reject);
	});
}

function rpcManage(body) {
	const campaignSlug = body.p_campaign_slug;
	const actorId = body.p_actor_profile_id;
	const targetId = body.p_target_profile_id;
	const expectedRevision = body.p_expected_revision;
	const changes = body.p_changes;
	const operationId = body.p_operation_id;
	const confirmSensitive = body.p_confirm_sensitive === true;
	const confirmSelfRevoke = body.p_confirm_self_revoke === true;

	if (
		typeof campaignSlug !== "string" ||
		typeof actorId !== "string" ||
		typeof targetId !== "string" ||
		!Array.isArray(changes) ||
		!changes.length ||
		typeof operationId !== "string"
	)
		return { status: "validation" };

	const replay = state.audits.find(
		(audit) => audit.new_value?.operationId === operationId,
	);
	if (replay)
		return {
			status: "replayed",
			revision: state.revisions.get(targetId) ?? 0,
			operationId,
		};

	const actorActions = effectiveActions(actorId, campaignSlug);
	if (!actorActions.includes("campaign.permissions.manage"))
		return { status: "forbidden" };

	const targetExists = profiles.some((profile) => profile.id === targetId);
	if (!targetExists) return { status: "target_not_found" };
	const campaign = campaignSlug === "yuhara-main" ? IDS.campaign : null;
	if (!campaign) return { status: "not_found" };
	const targetInCampaign =
		campaignMembers.some(
			(member) =>
				member.campaign_id === campaign && member.profile_id === targetId,
		) ||
		state.assignments.some(
			(assignment) =>
				assignment.profile_id === targetId &&
				assignment.scope_type === "campaign" &&
				assignment.scope_id === campaignSlug,
		);
	if (!targetInCampaign) return { status: "target_not_in_campaign" };

	const currentRevision = state.revisions.get(targetId) ?? 0;
	if (expectedRevision !== currentRevision)
		return { status: "conflict", revision: currentRevision };

	const seen = new Set();
	for (const change of changes) {
		if (
			!change ||
			!["grant", "revoke"].includes(change.operation) ||
			typeof change.roleId !== "string" ||
			seen.has(change.roleId)
		)
			return { status: "validation" };
		seen.add(change.roleId);
		const role = roles.find((row) => row.id === change.roleId);
		if (!role) return { status: "role_not_found" };
		const actions = roleActions(role.id);
		if (actions.some((action) => action.startsWith("project.")))
			return { status: "delegation_forbidden" };
		for (const sensitive of [
			"campaign.permissions.manage",
			"campaign.sessions.publish",
			"campaign.transcript.publish",
			"narrative.canon.approve",
		]) {
			if (actions.includes(sensitive) && !actorActions.includes(sensitive))
				return { status: "delegation_forbidden" };
		}
		if (
			actions.some((action) =>
				[
					"campaign.permissions.manage",
					"campaign.sessions.publish",
					"campaign.transcript.publish",
					"narrative.canon.approve",
				].includes(action),
			) &&
			!confirmSensitive
		)
			return {
				status: "confirmation_required",
				kind:
					change.operation === "grant"
						? "sensitive_grant"
						: "sensitive_revoke",
			};

		if (change.operation === "grant") {
			if (
				state.assignments.some(
					(assignment) =>
						assignment.profile_id === targetId &&
						assignment.role_id === role.id &&
						assignment.scope_type === "campaign" &&
						assignment.scope_id === campaignSlug &&
						["active", "eligible"].includes(assignment.status) &&
						assignment.ends_at === null,
				)
			)
				return { status: "duplicate" };
		} else {
			const assignment = state.assignments.find(
				(row) =>
					row.id === change.assignmentId &&
					row.profile_id === targetId &&
					row.role_id === role.id &&
					row.scope_type === "campaign" &&
					row.scope_id === campaignSlug &&
					isActive(row),
			);
			if (!assignment) return { status: "assignment_not_active" };
			if (actorId === targetId && !confirmSelfRevoke)
				return { status: "confirmation_required", kind: "self_revoke" };
		}
	}

	const now = new Date().toISOString();

	for (const change of changes.filter((row) => row.operation === "grant")) {
		const assignment = {
			id: randomUUID(),
			profile_id: targetId,
			role_id: change.roleId,
			scope_type: "campaign",
			scope_id: campaignSlug,
			status: "active",
			starts_at: now,
			ends_at: null,
			assigned_by: actorId,
			revoked_by: null,
			reason: body.p_reason || null,
			metadata: { operationId, source: "permissions-console" },
			created_at: now,
			updated_at: now,
		};
		state.assignments.push(assignment);
		state.audits.push({
			id: randomUUID(),
			campaign_id: campaign,
			actor_id: actorId,
			action: "permissions.role.grant",
			new_value: {
				operationId,
				source: "permissions-console",
				targetProfileId: targetId,
				roleId: change.roleId,
				scopeType: "campaign",
				scopeId: campaignSlug,
				status: "active",
				reason: body.p_reason || null,
			},
			created_at: now,
		});
	}

	for (const change of changes.filter((row) => row.operation === "revoke")) {
		const assignment = state.assignments.find(
			(row) => row.id === change.assignmentId,
		);
		if (!assignment) return { status: "assignment_not_active" };

		if (roleActions(change.roleId).includes("campaign.permissions.manage")) {
			const anotherAdmin = state.assignments.some(
				(row) =>
					row.id !== assignment.id &&
					isActive(row) &&
					roleActions(row.role_id).includes("campaign.permissions.manage") &&
					((row.scope_type === "campaign" &&
						row.scope_id === campaignSlug) ||
						(row.scope_type === "project" && row.scope_id === "tda")),
			);
			if (!anotherAdmin) return { status: "last_admin" };
		}

		assignment.status = "revoked";
		assignment.ends_at = now;
		assignment.revoked_by = actorId;
		assignment.reason = body.p_reason || assignment.reason;
		assignment.metadata = {
			...assignment.metadata,
			operationId,
			source: "permissions-console",
		};
		assignment.updated_at = now;
		state.audits.push({
			id: randomUUID(),
			campaign_id: campaign,
			actor_id: actorId,
			action: "permissions.role.revoke",
			new_value: {
				operationId,
				source: "permissions-console",
				targetProfileId: targetId,
				roleId: change.roleId,
				scopeType: "campaign",
				scopeId: campaignSlug,
				status: "revoked",
				reason: body.p_reason || null,
			},
			created_at: now,
		});
	}

	const revision = currentRevision + 1;
	state.revisions.set(targetId, revision);
	return { status: "updated", revision, operationId };
}

function tableRows(table) {
	if (table === "role_assignments") return state.assignments;
	if (table === "role_definitions") return roles;
	if (table === "role_permissions") return permissions;
	if (table === "profiles") return profiles;
	if (table === "campaign_members") return campaignMembers;
	if (table === "campaign_permission_revisions")
		return [...state.revisions].map(([profile_id, revision]) => ({
			campaign_id: IDS.campaign,
			profile_id,
			revision,
			updated_at: new Date().toISOString(),
		}));
	if (table === "audit_log") return state.audits;
	if (table === "campaigns")
		return [
			{ id: IDS.campaign, slug: "yuhara-main", name: "Campanha sintética" },
			{
				id: IDS.emptyCampaign,
				slug: "empty",
				name: "Campanha vazia",
			},
		];
	return null;
}

const server = createServer(async (request, response) => {
	const url = new URL(request.url, "http://127.0.0.1:3116");
	response.setHeader("Content-Type", "application/json");

	if (url.pathname === "/health") return response.end("{}");
	if (url.pathname === "/requests")
		return response.end(JSON.stringify(requests));
	if (url.pathname === "/reset" && request.method === "POST") {
		let body = {};
		try {
			body = await parseBody(request);
		} catch {
			/* keep default */
		}
		resetState({
			withoutProjectAdmin: body?.withoutProjectAdmin === true,
		});
		requests.length = 0;
		return response.end("{}");
	}

	requests.push({ method: request.method, path: url.pathname, query: url.search });

	if (url.pathname === "/auth/v1/user") {
		if (request.method !== "GET") {
			response.statusCode = 405;
			return response.end("{}");
		}
		try {
			const token = request.headers.authorization.split(" ")[1];
			const { sub: id } = JSON.parse(
				Buffer.from(token.split(".")[1], "base64url"),
			);
			if (id === "unavailable") {
				response.statusCode = 503;
				return response.end('{"message":"PRIVATE_FAILURE_DETAIL"}');
			}
			return response.end(
				JSON.stringify({
					id,
					aud: "authenticated",
					role: "authenticated",
					email: "PRIVATE_AUTH_EMAIL",
					app_metadata: {},
					user_metadata: { role: "master" },
					identities: [],
					created_at: "2020-01-01T00:00:00Z",
				}),
			);
		} catch {
			response.statusCode = 401;
			return response.end('{"msg":"invalid session"}');
		}
	}

	if (
		url.pathname === "/rest/v1/rpc/manage_campaign_role_assignments" &&
		request.method === "POST"
	) {
		try {
			const body = await parseBody(request);
			return response.end(JSON.stringify(rpcManage(body)));
		} catch {
			response.statusCode = 400;
			return response.end('{"message":"invalid json"}');
		}
	}

	if (request.method !== "GET") {
		response.statusCode = 405;
		return response.end("{}");
	}

	const table = url.pathname.replace("/rest/v1/", "");
	let rows = tableRows(table);
	if (!rows) {
		response.statusCode = 404;
		return response.end("{}");
	}
	rows = [...rows];

	for (const [column, filter] of url.searchParams) {
		if (filter.startsWith("eq."))
			rows = rows.filter(
				(row) => String(row[column]) === decodeURIComponent(filter.slice(3)),
			);
		if (filter.startsWith("in.("))
			rows = rows.filter((row) =>
				filter
					.slice(4, -1)
					.split(",")
					.map(decodeURIComponent)
					.includes(String(row[column])),
			);
		if (filter.startsWith("lte."))
			rows = rows.filter(
				(row) => Date.parse(row[column]) <= Date.parse(filter.slice(4)),
			);
	}

	const or = url.searchParams.get("or");
	if (or?.includes("scope_type.eq.campaign")) {
		const scope = or.match(/scope_id\.eq\.([a-z0-9-]+)/u)?.[1];
		rows = rows.filter(
			(row) =>
				(row.scope_type === "campaign" && row.scope_id === scope) ||
				(row.scope_type === "project" && row.scope_id === "tda"),
		);
	}
	if (or?.includes("ends_at.is.null"))
		rows = rows.filter(
			(row) => row.ends_at === null || Date.parse(row.ends_at) > Date.now(),
		);

	if (
		table === "role_assignments" &&
		or?.includes("scope_id.eq.empty")
	)
		rows = [];

	const count = rows.length;
	const limit = Number(url.searchParams.get("limit") ?? 1000);
	rows = rows.slice(0, limit);

	const select = url.searchParams.get("select");
	if (select) {
		const columns = select.split(",");
		rows = rows.map((row) =>
			Object.fromEntries(
				columns
					.filter((column) => column in row)
					.map((column) => [column, row[column]]),
			),
		);
	}

	response.setHeader(
		"Content-Range",
		`0-${Math.max(0, rows.length - 1)}/${count}`,
	);
	response.end(JSON.stringify(rows));
});

server.listen(3116, "127.0.0.1");
