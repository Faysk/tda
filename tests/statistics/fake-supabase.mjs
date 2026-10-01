// Loopback-only synthetic provider. Never connect this fixture to production.
import { createServer } from "node:http";

const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const campaigns = [
	{
		id: id(9001),
		slug: "yuhara-main",
		name: "Crônicas da Mesa",
		public_slug: "cronicas-da-mesa",
		lifecycle: "active",
	},
	{
		id: id(9002),
		slug: "other",
		name: "Antes que seja tarde",
		public_slug: "antes-que-seja-tarde",
		lifecycle: "active",
	},
	{
		id: id(9003),
		slug: "arquivo-antigo",
		name: "Memórias arquivadas",
		public_slug: "memorias-arquivadas",
		lifecycle: "archived",
	},
];
let revision = 0;

function subjectFromRequest(request) {
	try {
		return JSON.parse(
			Buffer.from(
				request.headers.authorization.split(".")[1],
				"base64url",
			).toString(),
		).sub;
	} catch {
		return null;
	}
}

function inFilter(value) {
	if (!value?.startsWith("in.(") || !value.endsWith(")")) return null;
	return value
		.slice(4, -1)
		.split(",")
		.map((item) => item.replace(/^"|"$/gu, ""));
}

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
		const subject = subjectFromRequest(request);
		if (!subject) return send({ message: "Invalid synthetic session" }, 401);
		return send({
			id: subject,
			aud: "authenticated",
			role: "authenticated",
			email: "fixture@example.invalid",
			app_metadata: {},
			user_metadata: {},
			created_at: "2026-01-01T00:00:00Z",
		});
	}

	const table = url.pathname.replace("/rest/v1/", "");
	if (table === "profiles") {
		const authUser = url.searchParams.get("auth_user_id");
		return send({ id: authUser?.startsWith("eq.") ? authUser.slice(3) : "unknown" });
	}

	if (table === "role_assignments") {
		const profileFilter = url.searchParams.get("profile_id");
		const profile = profileFilter?.startsWith("eq.") ? profileFilter.slice(3) : "";
		const assignment = (role_id, scope_type, scope_id) => ({
			role_id,
			scope_type,
			scope_id,
			status: "active",
			starts_at: "2020-01-01T00:00:00Z",
			ends_at: null,
		});
		if (profile === "reader")
			return send([assignment("read-role", "campaign", "yuhara-main")]);
		if (profile === "reader-ab")
			return send([
				assignment("read-role", "campaign", "yuhara-main"),
				assignment("read-role", "campaign", "other"),
			]);
		if (profile === "project-reader")
			return send([assignment("read-role", "project", "tda")]);
		if (profile === "archived-reader")
			return send([assignment("read-role", "campaign", "arquivo-antigo")]);
		if (profile === "reviewer-ab")
			return send([
				assignment("review-role", "campaign", "yuhara-main"),
				assignment("review-role", "campaign", "other"),
			]);
		if (profile === "project-reviewer")
			return send([assignment("review-role", "project", "tda")]);
		return send([]);
	}

	if (table === "role_permissions")
		return send([
			{ role_id: "read-role", permission_action: "campaign.transcript.read" },
			{ role_id: "review-role", permission_action: "narrative.review.read" },
			{ role_id: "review-role", permission_action: "narrative.review.manage" },
			{ role_id: "review-role", permission_action: "narrative.canon.approve" },
			{ role_id: "review-role", permission_action: "campaign.transcript.read" },
		]);

	if (table === "campaigns") {
		let rows = campaigns;
		const slugEq = url.searchParams.get("slug");
		const slugs = inFilter(slugEq);
		if (slugs) rows = rows.filter((campaign) => slugs.includes(campaign.slug));
		else if (slugEq?.startsWith("eq."))
			rows = rows.filter((campaign) => campaign.slug === slugEq.slice(3));
		const lifecycle = url.searchParams.get("lifecycle");
		if (lifecycle?.startsWith("eq."))
			rows = rows.filter(
				(campaign) => campaign.lifecycle === lifecycle.slice(3),
			);
		const projection = rows.map((campaign) => {
			const select = url.searchParams.get("select") ?? "";
			if (select === "id") return { id: campaign.id };
			if (select === "lifecycle") return { lifecycle: campaign.lifecycle };
			return {
				slug: campaign.slug,
				name: campaign.name,
				lifecycle: campaign.lifecycle,
			};
		});
		if (
			String(request.headers.accept ?? "").includes(
				"application/vnd.pgrst.object+json",
			)
		)
			return send(projection[0] ?? null);
		return send(projection);
	}

	const after = url.searchParams.get("id")?.slice(3);
	if (table === "sessions") {
		const campaignJoin = url.searchParams.get("campaigns.slug");
		if (campaignJoin?.startsWith("eq.")) {
			const campaignSlug = campaignJoin.slice(3);
			const rows =
				campaignSlug === "yuhara-main"
					? [
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
						]
					: campaignSlug === "other"
						? [
								{
									// Deliberately reuses A's synthetic session id. The campaign
									// join must still keep the metrics isolated.
									id: id(1),
									title: "A mesma identidade em outra campanha",
									session_date: "2026-09-03",
									duration_ms: 120_000,
								},
							]
						: campaignSlug === "arquivo-antigo"
							? [
									{
										id: id(201),
										title: "Sessão histórica",
										session_date: "2025-01-01",
										duration_ms: 30_000,
									},
								]
							: [];
			return send(rows.filter((row) => !after || row.id > after).slice(0, 2));
		}

		const campaignId = url.searchParams.get("campaign_id");
		if (campaignId?.startsWith("eq.")) {
			const selected = campaigns.find(
				(campaign) => campaign.id === campaignId.slice(3),
			);
			if (!selected) return send([]);
			return send([
				{
					id:
						selected.slug === "yuhara-main"
							? id(301)
							: selected.slug === "other"
								? id(302)
								: id(303),
					title: `Fila ${selected.name}`,
					session_date: "2026-09-01",
				},
			]);
		}
		return send({ message: "Missing campaign scope" }, 400);
	}

	if (table === "canon_candidates") return send([]);

	if (table === "transcript_session_statistics") {
		const campaignJoin = url.searchParams.get("sessions.campaigns.slug");
		if (!campaignJoin?.startsWith("eq.") || !url.searchParams.has("session_id"))
			return send({ message: "Missing aggregate session/campaign scope" }, 400);
		const campaignSlug = campaignJoin.slice(3);
		const sessionFilter = url.searchParams.get("session_id") ?? "";
		const rows =
			campaignSlug === "yuhara-main"
				? [
						{
							session_id: id(1),
							segment_count: 205,
							complete_text_count: 205,
							word_count: revision ? 615 : 410,
						},
						{
							session_id: id(2),
							segment_count: 1,
							complete_text_count: 1,
							word_count: 0,
						},
					]
				: campaignSlug === "other"
					? [
							{
								session_id: id(1),
								segment_count: 2,
								complete_text_count: 2,
								word_count: 7,
							},
						]
					: campaignSlug === "arquivo-antigo"
						? [
								{
									session_id: id(201),
									segment_count: 1,
									complete_text_count: 1,
									word_count: 3,
								},
							]
						: [];
		return send(rows.filter((row) => sessionFilter.includes(row.session_id)));
	}

	if (table === "transcript_segments") {
		const campaignJoin = url.searchParams.get("sessions.campaigns.slug");
		if (!campaignJoin?.startsWith("eq.") || !url.searchParams.has("session_id"))
			return send({ message: "Missing session/campaign scope" }, 400);
		const campaignSlug = campaignJoin.slice(3);
		const session = url.searchParams.get("session_id").slice(3);
		const rows =
			campaignSlug === "yuhara-main" && session === id(1)
				? Array.from({ length: 205 }, (_, n) => ({
						id: id(n + 10),
						session_id: session,
						source_segment_id: String(n),
						text: revision
							? "TRANSCRICAO_PRIVADA teste revisado"
							: "TRANSCRICAO_PRIVADA ação",
					}))
				: campaignSlug === "yuhara-main" && session === id(2)
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
