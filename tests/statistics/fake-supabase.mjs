// Loopback-only synthetic provider. Never connect this fixture to production.
import { createServer } from "node:http";
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let revision = 0;
createServer((request, response) => {
	const url = new URL(request.url, "http://127.0.0.1:3103");
	const send = (data, status = 200) => {
		response.writeHead(status, { "Content-Type": "application/json" });
		response.end(JSON.stringify(data));
	};
	if (url.pathname === "/health") return send({ ok: true });
	if (url.pathname === "/fixture/reset" && request.method === "POST") {
		revision = 0;
		return send({ revision });
	}
	if (url.pathname === "/fixture/revise" && request.method === "POST") {
		revision++;
		return send({ revision });
	}
	if (url.pathname === "/auth/v1/user") {
		try {
			const subject = JSON.parse(
				Buffer.from(
					request.headers.authorization.split(".")[1],
					"base64url",
				).toString(),
			).sub;
			return send({
				id: subject,
				aud: "authenticated",
				role: "authenticated",
				email: "fixture@example.invalid",
				app_metadata: {},
				user_metadata: {},
				created_at: "2026-01-01T00:00:00Z",
			});
		} catch {
			return send({ message: "Invalid synthetic session" }, 401);
		}
	}
	const table = url.pathname.replace("/rest/v1/", "");
	if (table === "profiles")
		return send({ id: url.searchParams.get("auth_user_id").slice(3) });
	if (table === "role_assignments") {
		if (url.searchParams.get("profile_id") !== "eq.reader") return send([]);
		return send([
			{
				role_id: "read-role",
				scope_type: "campaign",
				scope_id: "yuhara-main",
				status: "active",
				starts_at: "2020-01-01T00:00:00Z",
				ends_at: null,
			},
		]);
	}
	if (table === "role_permissions")
		return send([
			{ role_id: "read-role", permission_action: "campaign.transcript.read" },
		]);
	const after = url.searchParams.get("id")?.slice(3);
	if (table === "sessions") {
		if (url.searchParams.get("campaigns.slug") !== "eq.yuhara-main")
			return send({ message: "Missing campaign scope" }, 400);
		const rows = [
			{
				id: id(1),
				title: "A travessia das montanhas",
				session_date: "2026-09-01",
				duration_ms: 3_660_000,
			},
			{
				id: id(2),
				title: "O reencontro à beira do rio",
				session_date: "2026-09-02",
				duration_ms: null,
			},
			{
				id: id(3),
				title: "Uma nova jornada",
				session_date: null,
				duration_ms: 60_000,
			},
		];
		// Deliberately cap below the requested limit to prove complete traversal.
		return send(rows.filter((row) => !after || row.id > after).slice(0, 2));
	}
	if (table === "transcript_segments") {
		if (
			url.searchParams.get("sessions.campaigns.slug") !== "eq.yuhara-main" ||
			!url.searchParams.has("session_id")
		)
			return send({ message: "Missing session/campaign scope" }, 400);
		const session = url.searchParams.get("session_id").slice(3);
		const rows =
			session === id(1)
				? Array.from({ length: 205 }, (_, n) => ({
						id: id(n + 10),
						session_id: session,
						source_segment_id: String(n),
						text: revision
							? "TRANSCRICAO_PRIVADA teste revisado"
							: "TRANSCRICAO_PRIVADA ação",
					}))
				: session === id(2)
					? [
							{
								id: id(10),
								session_id: session,
								source_segment_id: "empty",
								text: "",
							},
						]
					: [];
		return send(rows.filter((row) => !after || row.id > after).slice(0, 100));
	}
	return send({ message: "Unexpected fixture endpoint" }, 404);
}).listen(3103, "127.0.0.1");
