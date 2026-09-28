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

import { findEditSessionBySourceId } from "./repository";

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
