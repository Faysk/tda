import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	client: vi.fn(),
	requireUnsafeEdit: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/integrations/supabase/server", () => ({
	editDataClient: mocks.client,
}));
vi.mock("../unsafe-access", () => ({
	requireUnsafeEdit: mocks.requireUnsafeEdit,
}));

import { findEditSessionBySourceId, listEditSessionLibrary } from "./repository";

type QueryCall = Readonly<{
	method: string;
	args: unknown[];
}>;

function setupSessions(result: {
	data: unknown;
	error: unknown;
}) {
	const calls: QueryCall[] = [];
	mocks.client.mockReturnValue({
		from: (table: string) => {
			expect(table).toBe("sessions");
			const query = Promise.resolve(result);
			for (const method of ["select", "eq", "maybeSingle"]) {
				Object.assign(query, {
					[method]: (...args: unknown[]) => {
						calls.push({ method, args });
						return query;
					},
				});
			}
			return query;
		},
	});
	return calls;
}

type TableResult = Readonly<{ data: unknown; error: unknown }>;

function setupTableResults(results: Record<string, TableResult[]>) {
	const calls: Array<QueryCall & { table: string }> = [];
	const fromCounts = new Map<string, number>();
	mocks.client.mockReturnValue({
		from: (table: string) => {
			fromCounts.set(table, (fromCounts.get(table) ?? 0) + 1);
			const queue = results[table] ?? [];
			const result = queue.shift() ?? { data: [], error: null };
			const query = Promise.resolve(result);
			for (const method of ["select", "eq", "order", "limit", "gt", "in"]) {
				Object.assign(query, {
					[method]: (...args: unknown[]) => {
						calls.push({ table, method, args });
						return query;
					},
				});
			}
			return query;
		},
	});
	return { calls, fromCounts };
}

function uuid(prefix: string, index: number): string {
	return `${prefix}0000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("supported Edit session lookup", () => {
	it("scopes the lookup to campaign and source session without the unsafe gate", async () => {
		const calls = setupSessions({
			data: {
				id: "session-1",
				source_session_id: "craig-session-1",
				title: "Sessão sintética",
				session_date: "2026-09-27",
				arc: "Yuhara",
				status: "approved",
			},
			error: null,
		});

		await expect(
			findEditSessionBySourceId("yuhara-main", "craig-session-1"),
		).resolves.toEqual({
			id: "session-1",
			sourceSessionId: "craig-session-1",
			title: "Sessão sintética",
			sessionDate: "2026-09-27",
			arc: "Yuhara",
			status: "approved",
		});

		expect(calls).toContainEqual({
			method: "eq",
			args: ["campaigns.slug", "yuhara-main"],
		});
		expect(calls).toContainEqual({
			method: "eq",
			args: ["source_session_id", "craig-session-1"],
		});
		expect(mocks.requireUnsafeEdit).not.toHaveBeenCalled();
	});

	it("returns null when the campaign-scoped target is absent", async () => {
		setupSessions({ data: null, error: null });
		await expect(
			findEditSessionBySourceId("yuhara-main", "missing"),
		).resolves.toBeNull();
	});

	it("fails closed when the supported data dependency fails", async () => {
		setupSessions({ data: null, error: { message: "PRIVATE" } });
		await expect(
			findEditSessionBySourceId("yuhara-main", "craig-session-1"),
		).rejects.toThrow("Edit session lookup unavailable");
	});

	it("distinguishes unavailable data connection from a missing target", async () => {
		mocks.client.mockReturnValue(null);
		await expect(
			findEditSessionBySourceId("yuhara-main", "craig-session-1"),
		).rejects.toThrow("Edit data connection is unavailable");
	});

	it.each(["", "UPPER", "-invalid", "invalid-", "a".repeat(81)])(
		"rejects invalid campaign scope %s",
		async (campaignSlug) => {
			await expect(
				findEditSessionBySourceId(campaignSlug, "craig-session-1"),
			).rejects.toThrow("Invalid campaign");
			expect(mocks.client).not.toHaveBeenCalled();
		},
	);

	it("rejects malformed source ids before touching storage", async () => {
		await expect(
			findEditSessionBySourceId("yuhara-main", ""),
		).resolves.toBeNull();
		await expect(
			findEditSessionBySourceId("yuhara-main", "x".repeat(221)),
		).resolves.toBeNull();
		expect(mocks.client).not.toHaveBeenCalled();
	});
});

describe("supported Edit session library thumbnails", () => {
	it("returns an empty library without related lookups", async () => {
		const { fromCounts } = setupTableResults({
			sessions: [{ data: [], error: null }],
		});

		await expect(listEditSessionLibrary("yuhara-main")).resolves.toEqual([]);
		expect(fromCounts.get("sessions")).toBe(1);
		expect(fromCounts.get("session_editorial_drafts") ?? 0).toBe(0);
		expect(fromCounts.get("media_assets") ?? 0).toBe(0);
	});

	it("prefers a verified private draft cover and keeps the projection metadata-only", async () => {
		const sessionId = "10000000-0000-4000-8000-000000000001";
		const draftId = "20000000-0000-4000-8000-000000000001";
		const coverId = "30000000-0000-4000-8000-000000000001";
		const { calls } = setupTableResults({
			sessions: [
				{
					data: [
						{
							id: sessionId,
							source_session_id: "craig-session-1",
							title: "Sessão sintética",
							session_date: "2026-09-28",
							arc: "Yuhara",
							status: "published",
							current_transcript_revision_id: "revision-1",
							current_editorial_draft_id: draftId,
							cover_image_url: "https://media.dnd.faysk.dev/campaigns/yuhara-main/sessions/public.webp",
						},
					],
					error: null,
				},
			],
			session_editorial_drafts: [
				{
					data: [{ id: draftId, session_id: sessionId, cover_asset_id: coverId }],
					error: null,
				},
			],
			media_assets: [
				{
					data: [
						{
							id: coverId,
							status: "staged",
							role_hint: "session_cover",
							read_back_verified: true,
						},
					],
					error: null,
				},
			],
		});

		const result = await listEditSessionLibrary("yuhara-main");
		expect(result).toHaveLength(1);
		expect(result[0]?.thumbnail).toEqual({
			kind: "private",
			src: `/api/edit/campaigns/yuhara-main/session-cover/${sessionId}/${coverId}`,
		});
		const sessionSelect = calls.find(
			(call) => call.table === "sessions" && call.method === "select",
		);
		expect(String(sessionSelect?.args[0])).not.toContain("summary_full");
		expect(String(sessionSelect?.args[0])).not.toContain("transcript_segments");
	});

	it("falls back to the verified public cover when a private draft asset is not readable", async () => {
		const sessionId = "10000000-0000-4000-8000-000000000002";
		const draftId = "20000000-0000-4000-8000-000000000002";
		const coverId = "30000000-0000-4000-8000-000000000002";
		setupTableResults({
			sessions: [
				{
					data: [
						{
							id: sessionId,
							source_session_id: "craig-session-2",
							title: "Sessão publicada",
							session_date: null,
							arc: null,
							status: "published",
							current_transcript_revision_id: "revision-2",
							current_editorial_draft_id: draftId,
							cover_image_url: "/assets/sessions/fallback.webp",
						},
					],
					error: null,
				},
			],
			session_editorial_drafts: [
				{
					data: [{ id: draftId, session_id: sessionId, cover_asset_id: coverId }],
					error: null,
				},
			],
			media_assets: [
				{
					data: [
						{
							id: coverId,
							status: "retired",
							role_hint: "session_cover",
							read_back_verified: true,
						},
					],
					error: null,
				},
			],
		});

		await expect(listEditSessionLibrary("yuhara-main")).resolves.toMatchObject([
			{ thumbnail: { kind: "public", src: "/assets/sessions/fallback.webp" } },
		]);
	});

	it("batches related lookups for 250 sessions instead of issuing per-row queries", async () => {
		const sessions = Array.from({ length: 250 }, (_, index) => ({
			id: uuid("1", index),
			source_session_id: `craig-${index}`,
			title: `Sessão ${index}`,
			session_date: "2026-09-28",
			arc: "Yuhara",
			status: "ready_for_review",
			current_transcript_revision_id: `revision-${index}`,
			current_editorial_draft_id: uuid("2", index),
			cover_image_url: null,
		}));
		const drafts = sessions.map((session, index) => ({
			id: session.current_editorial_draft_id,
			session_id: session.id,
			cover_asset_id: uuid("3", index),
		}));
		const assets = drafts.map((draft) => ({
			id: draft.cover_asset_id,
			status: "staged",
			role_hint: "session_cover",
			read_back_verified: true,
		}));
		const { fromCounts } = setupTableResults({
			sessions: [
				{ data: sessions.slice(0, 200), error: null },
				{ data: sessions.slice(200), error: null },
			],
			session_editorial_drafts: [
				{ data: drafts.slice(0, 200), error: null },
				{ data: drafts.slice(200), error: null },
			],
			media_assets: [
				{ data: assets.slice(0, 200), error: null },
				{ data: assets.slice(200), error: null },
			],
		});

		const result = await listEditSessionLibrary("yuhara-main");
		expect(result).toHaveLength(250);
		expect(result.every((session) => session.thumbnail?.kind === "private")).toBe(true);
		expect(fromCounts.get("sessions")).toBe(2);
		expect(fromCounts.get("session_editorial_drafts")).toBe(2);
		expect(fromCounts.get("media_assets")).toBe(2);
	});
});
