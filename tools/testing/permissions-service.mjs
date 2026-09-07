// Synthetic HTTP fixture for the production app's real Auth + PostgREST clients.
// Never imported by src/ or deployed. No production credentials or data.
import { createServer } from "node:http";

const roles = [
	{ id: "manage", name: "Gestão sintética", slug: "synthetic-manager" },
	{ id: "read", name: "Leitura sintética", slug: "synthetic-reader" },
	{ id: "technical", name: "Operação técnica", slug: "synthetic-technical" },
];
const permissions = [
	{ role_id: "manage", permission_action: "campaign.permissions.manage" },
	{ role_id: "read", permission_action: "campaign.transcript.read" },
	{ role_id: "technical", permission_action: "project.jobs.run" },
];
const profiles = [
	"manager",
	"reader",
	"project",
	"expired",
	"foreign",
	"technical",
].map((id) => ({
	id,
	display_name: `Pessoa ${id}`,
	auth_user_id: id,
	discord_id: `PRIVATE_DISCORD_${id}`,
	email: "PRIVATE_EMAIL",
	metadata: { secret: "PRIVATE_METADATA" },
}));
const assignments = profiles.map(({ id }) => ({
	id: `assignment-${id}`,
	profile_id: id,
	role_id: ["manager", "project", "expired", "foreign"].includes(id)
		? "manage"
		: id === "technical"
			? "technical"
			: "read",
	scope_type: ["project", "technical"].includes(id) ? "project" : "campaign",
	scope_id: ["project", "technical"].includes(id)
		? "tda"
		: id === "foreign"
			? "other-campaign"
			: "yuhara-main",
	status: id === "expired" ? "revoked" : "active",
	starts_at: "2020-01-01T00:00:00Z",
	ends_at: null,
}));
const tables = {
	profiles,
	role_assignments: assignments,
	role_definitions: roles,
	role_permissions: permissions,
	campaigns: [
		{ slug: "yuhara-main", name: "Campanha sintética" },
		{ slug: "empty", name: "Campanha vazia" },
	],
};
const requests = [];
const server = createServer((request, response) => {
	const url = new URL(request.url, "http://127.0.0.1:3116");
	response.setHeader("Content-Type", "application/json");
	if (url.pathname === "/health") return response.end("{}");
	if (url.pathname === "/requests")
		return response.end(JSON.stringify(requests));
	requests.push({ path: url.pathname, query: url.search });
	if (request.method !== "GET") {
		response.statusCode = 405;
		return response.end("{}");
	}
	if (url.pathname === "/auth/v1/user") {
		try {
			const token = request.headers.authorization.split(" ")[1];
			const { sub: id } = JSON.parse(
				Buffer.from(token.split(".")[1], "base64url"),
			);
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
	const table = url.pathname.replace("/rest/v1/", "");
	if (url.searchParams.get("auth_user_id") === "eq.unavailable") {
		response.statusCode = 503;
		return response.end('{"message":"PRIVATE_FAILURE_DETAIL"}');
	}
	let rows = tables[table];
	if (!rows) {
		response.statusCode = 404;
		return response.end("{}");
	}
	for (const [column, filter] of url.searchParams) {
		if (filter.startsWith("eq."))
			rows = rows.filter((row) => row[column] === filter.slice(3));
		if (filter.startsWith("in.("))
			rows = rows.filter((row) =>
				filter.slice(4, -1).split(",").includes(row[column]),
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
	// A deliberately empty fixture exercises the real empty response after a project guard.
	if (table === "role_assignments" && or?.includes("scope_id.eq.empty"))
		rows = [];
	const count = rows.length;
	const columns = (url.searchParams.get("select") ?? "").split(",");
	rows = rows
		.slice(0, Number(url.searchParams.get("limit") ?? 1000))
		.map((row) =>
			Object.fromEntries(
				columns
					.filter((column) => column in row)
					.map((column) => [column, row[column]]),
			),
		);
	response.setHeader(
		"Content-Range",
		`0-${Math.max(0, rows.length - 1)}/${count}`,
	);
	response.end(JSON.stringify(rows));
});
server.listen(3116, "127.0.0.1");
