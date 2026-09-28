import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	client: vi.fn(),
	requireUnsafeEdit: vi.fn(() => {
		throw new Error("unsafe boundary must not be used");
	}),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/integrations/supabase/server", () => ({
	editDataClient: mocks.client,
}));
vi.mock("../unsafe-access", () => ({
	requireUnsafeEdit: mocks.requireUnsafeEdit,
}));

import { findEditSessionBySourceId } from "./repository";

function setup(result: {
	data?: Record<string, unknown> | null;
	error?: unknown;
} = {}) {
	const calls: { method: string; args: unknown[] }[] = [];
	const response = Promise.resolve({
		data:
			result.data === undefined
				? {
						id: "session-1",
						source_session_id: "craig-1",
						title: "Sessão sintética",
						session_date: "2026-09-28",
						arc: "Teste",
						status: "ready_for_review",
					}
				: result.data,
		error: result.error ?? null,
	});
	for (const method of ["select", "eq", "maybeSingle"]) {
		Object.assign(response, {
			[method]: (...args: unknown[]) => {
				calls.push({ method, args });
				return response;
			},
		});
	}
	mocks.client.mockReturnValue({
		from: (table: string) => {
			expect(table).toBe("sessions");
			return response;
		},
	});
	return calls;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("supported Edit session lookup", () => {
	it("reads a session without crossing the legacy unsafe boundary", async () => {
		const calls = setup();
		await expect(
			findEditSessionBySourceId("yuhara-main", "craig-1"),
		).resolves.toMatchObject({
			id: "session-1",
			sourceSessionId: "craig-1",
			title: "Sessão sintética",
		});
		expect(mocks.requireUnsafeEdit).not.toHaveBeenCalled();
		expect(calls).toContainEqual({
			method: "eq",
			args: ["campaigns.slug", "yuhara-main"],
		});
		expect(calls).toContainEqual({
			method: "eq",
			args: ["source_session_id", "craig-1"],
		});
	});

	it("returns null for an absent or out-of-campaign target without disclosure", async () => {
		setup({ data: null });
		await expect(
			findEditSessionBySourceId("yuhara-main", "outside"),
		).resolves.toBeNull();
	});

	it("fails closed when the supported Edit data connection is unavailable", async () => {
		mocks.client.mockReturnValue(null);
		await expect(
			findEditSessionBySourceId("yuhara-main", "craig-1"),
		).rejects.toThrow("Edit data connection is unavailable");
	});

	it("fails closed when the scoped lookup fails", async () => {
		setup({ data: null, error: { message: "PRIVATE" } });
		await expect(
			findEditSessionBySourceId("yuhara-main", "craig-1"),
		).rejects.toThrow("Edit session lookup unavailable");
	});

	it.each(["", "-invalid", "UPPER", "a".repeat(82)])(
		"rejects invalid campaign slug %j before querying",
		async (campaignSlug) => {
			await expect(
				findEditSessionBySourceId(campaignSlug, "craig-1"),
			).rejects.toThrow("Invalid campaign");
			expect(mocks.client).not.toHaveBeenCalled();
		},
	);
});
