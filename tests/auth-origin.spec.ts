import { expect, test } from "@playwright/test";

const origin = "http://127.0.0.1:3103";
test.use({ baseURL: origin });

test("real browser login form keeps Origin and stops at synthetic consent", async ({
	page,
}) => {
	const document = await page.goto("/entrar");
	expect(document?.headers()["referrer-policy"]).toBe("same-origin");
	const submitted = page.waitForResponse(
		(response) => response.url() === `${origin}/auth/discord`,
	);
	await page
		.getByRole("button", { name: "Entrar com Discord", exact: true })
		.click();
	const response = await submitted;
	expect(response.request().headers().origin).toBe(origin);
	expect(response.status()).toBe(303);
	expect(response.headers()["referrer-policy"]).toBe("no-referrer");
	await expect(
		page.getByRole("heading", { name: "Consentimento sintético — parar aqui" }),
	).toBeVisible();
});

test("real browser account logout form keeps Origin and clears its session", async ({
	page,
	context,
}) => {
	// Only this loopback provider accepts this unsigned synthetic session.
	const session = {
		access_token: "synthetic-access-token",
		refresh_token: "synthetic-refresh-token",
		expires_at: Math.floor(Date.now() / 1000) + 600,
	};
	await context.addCookies([
		{
			name: "tda-discord-session",
			value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`,
			url: origin,
			httpOnly: true,
			sameSite: "Lax",
		},
	]);
	const document = await page.goto("/conta");
	expect(document?.headers()["referrer-policy"]).toBe("same-origin");
	const submitted = page.waitForResponse(
		(response) => response.url() === `${origin}/auth/logout`,
	);
	await page
		.getByRole("button", { name: "Sair da conta", exact: true })
		.click();
	const response = await submitted;
	expect(response.request().headers().origin).toBe(origin);
	expect(response.status()).toBe(303);
	expect(response.headers()["referrer-policy"]).toBe("no-referrer");
	await expect(page).toHaveURL(/\/entrar\?saida=1$/);
	expect(
		(await context.cookies()).some((cookie) =>
			cookie.name.startsWith("tda-discord-session"),
		),
	).toBe(false);
});

test("configured auth rejects absent, null and foreign Origin", async ({
	request,
}) => {
	for (const path of ["/auth/discord", "/auth/logout"]) {
		for (const supplied of [undefined, "null", "https://foreign.invalid"]) {
			const headers: Record<string, string> =
				supplied === undefined ? {} : { origin: supplied };
			expect(
				(await request.post(path, { headers, maxRedirects: 0 })).status(),
			).toBe(403);
		}
	}
	const callback = await request.get("/auth/callback", { maxRedirects: 0 });
	expect(callback.status()).toBe(303);
	expect(callback.headers()["referrer-policy"]).toBe("no-referrer");
});
