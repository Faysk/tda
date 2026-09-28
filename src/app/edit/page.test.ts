import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	currentAccess: vi.fn(),
	selectEditEntrypoint: vi.fn(),
	redirect: vi.fn((url: string) => {
		throw new Error(`redirect:${url}`);
	}),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/features/auth/server", () => ({ currentAccess: mocks.currentAccess }));
vi.mock("@/features/edit/access/entrypoint", () => ({
	selectEditEntrypoint: mocks.selectEditEntrypoint,
}));
vi.mock("@/features/sessions/model", () => ({ CAMPAIGN_SLUG: "yuhara-main" }));

import EditPage from "./page";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.selectEditEntrypoint.mockReturnValue(null);
});

describe("/edit compatibility entrypoint", () => {
	it.each([
		[
			{ state: "anonymous", context: null },
			"/entrar?next=%2Fedit",
		],
		[
			{ state: "unavailable", context: null },
			"/conta?acesso=indisponivel",
		],
		[
			{ state: "authenticated_unlinked", context: { profileId: null, grants: [] } },
			"/conta?acesso=negado",
		],
		[
			{
				state: "authenticated_linked_no_grants",
				context: { profileId: "profile", grants: [] },
			},
			"/conta?acesso=negado",
		],
	] as const)("redirects %s without rendering a menu", async (access, expected) => {
		mocks.currentAccess.mockResolvedValueOnce(access);
		await expect(EditPage()).rejects.toThrow(`redirect:${expected}`);
		expect(mocks.redirect).toHaveBeenCalledWith(expected);
		expect(mocks.selectEditEntrypoint).not.toHaveBeenCalled();
	});

	it("redirects linked accounts to the selected authorized tool", async () => {
		const context = {
			authUserId: "auth-user",
			profileId: "profile",
			grants: [],
		};
		mocks.currentAccess.mockResolvedValueOnce({
			state: "authenticated_linked",
			context,
		});
		mocks.selectEditEntrypoint.mockReturnValueOnce("/edit/processamento");

		await expect(EditPage()).rejects.toThrow("redirect:/edit/processamento");
		expect(mocks.selectEditEntrypoint).toHaveBeenCalledWith(
			context,
			"yuhara-main",
		);
	});

	it("routes a linked account with no visible Edit destination to access recovery", async () => {
		mocks.currentAccess.mockResolvedValueOnce({
			state: "authenticated_linked",
			context: {
				authUserId: "auth-user",
				profileId: "profile",
				grants: [],
			},
		});
		mocks.selectEditEntrypoint.mockReturnValueOnce(null);

		await expect(EditPage()).rejects.toThrow("redirect:/conta?acesso=negado");
	});
});
