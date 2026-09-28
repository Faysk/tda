import { describe, expect, it, vi } from "vitest";
import {
	CURRENT_MUTATION_EVENT_VERSION,
	createCurrentPublicationMutationHandler,
} from "./current-mutation";
import { deniedPublicationDependencies } from "./consumer";

const actor = {
	authUserId: "auth-user",
	profileId: "33333333-3333-4333-8333-333333333333",
	campaignId: "44444444-4444-4444-8444-444444444444",
	sessionId: "55555555-5555-4555-8555-555555555555",
};

const request = (
	body: unknown = {
		campaignSlug: "yuhara-main",
		sourceSessionId: "sessao-real",
		operationId: "66666666-6666-4666-8666-666666666666",
		revisionId: null,
		expectedCurrentRevisionId: "77777777-7777-4777-8777-777777777777",
		expectedActorProfileId: actor.profileId,
	},
	origin = "https://tda.test",
) =>
	new Request("https://tda.test/api/transcript-publications/current/set", {
		method: "POST",
		headers: { origin, "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});

describe("current transcript publication mutation", () => {
	it("authorizes campaign scope before invoking the server-only mutation", async () => {
		const mutate = vi.fn();
		const handler = createCurrentPublicationMutationHandler({
			origin: () => "https://tda.test",
			identity: async () => ({ ok: true, authUserId: actor.authUserId }),
			publication: {
				...deniedPublicationDependencies,
				authorize: async () => ({
					ok: false as const,
					reason: "forbidden" as const,
				}),
			},
			mutate,
		});
		expect((await handler(request())).status).toBe(403);
		expect(mutate).not.toHaveBeenCalled();
	});

	it("commits an authorized unpublish and validates the returned event", async () => {
		const mutate = vi.fn(async () => ({
			ok: true as const,
			event: {
				schemaVersion: CURRENT_MUTATION_EVENT_VERSION,
				eventId: "88888888-8888-4888-8888-888888888888",
				campaignId: actor.campaignId,
				sessionId: actor.sessionId,
				operationId: "66666666-6666-4666-8666-666666666666",
				action: "unpublish" as const,
				revisionId: null,
				previousRevisionId: "77777777-7777-4777-8777-777777777777",
				committedAt: "2026-09-28T22:00:00Z",
			},
		}));
		const handler = createCurrentPublicationMutationHandler({
			origin: () => "https://tda.test",
			identity: async () => ({ ok: true, authUserId: actor.authUserId }),
			publication: {
				...deniedPublicationDependencies,
				authorize: async () => ({ ok: true as const, actor }),
			},
			mutate,
		});
		const response = await handler(request());
		expect(response.status).toBe(200);
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		expect(mutate).toHaveBeenCalledWith(actor, {
			operationId: "66666666-6666-4666-8666-666666666666",
			revisionId: null,
			expectedCurrentRevisionId: "77777777-7777-4777-8777-777777777777",
		});
		expect((await response.json()).ok).toBe(true);
	});

	it("rejects actor drift, malformed payloads and mismatched events fail closed", async () => {
		const mutate = vi.fn(async () => ({
			ok: true as const,
			event: {
				schemaVersion: CURRENT_MUTATION_EVENT_VERSION,
				eventId: "88888888-8888-4888-8888-888888888888",
				campaignId: actor.campaignId,
				sessionId: actor.sessionId,
				operationId: "66666666-6666-4666-8666-666666666666",
				action: "restore" as const,
				revisionId: "99999999-9999-4999-8999-999999999999",
				previousRevisionId: null,
				committedAt: "2026-09-28T22:00:00Z",
			},
		}));
		const handler = createCurrentPublicationMutationHandler({
			origin: () => "https://tda.test",
			identity: async () => ({ ok: true, authUserId: actor.authUserId }),
			publication: {
				...deniedPublicationDependencies,
				authorize: async () => ({ ok: true as const, actor }),
			},
			mutate,
		});

		expect(
			(
				await handler(
					request({
						campaignSlug: "yuhara-main",
						sourceSessionId: "sessao-real",
						operationId: "66666666-6666-4666-8666-666666666666",
						revisionId: null,
						expectedCurrentRevisionId:
							"77777777-7777-4777-8777-777777777777",
						expectedActorProfileId:
							"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
					}),
				)
			).status,
		).toBe(403);

		expect(
			(
				await handler(
					request({
						campaignSlug: "yuhara-main",
						sourceSessionId: "sessao-real",
						operationId: "not-a-uuid",
						revisionId: null,
						expectedCurrentRevisionId: null,
						expectedActorProfileId: actor.profileId,
					}),
				)
			).status,
		).toBe(400);

		expect((await handler(request())).status).toBe(503);
	});

	it("maps stale current to conflict without rewriting the response", async () => {
		const handler = createCurrentPublicationMutationHandler({
			origin: () => "https://tda.test",
			identity: async () => ({ ok: true, authUserId: actor.authUserId }),
			publication: {
				...deniedPublicationDependencies,
				authorize: async () => ({ ok: true as const, actor }),
			},
			mutate: async () => ({ ok: false as const, reason: "stale_current" as const }),
		});
		const response = await handler(request());
		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			ok: false,
			reason: "stale_current",
		});
	});
});
