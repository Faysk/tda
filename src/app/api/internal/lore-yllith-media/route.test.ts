import { afterEach, describe, expect, it } from "vitest";
import { POST } from "./route";

const ENV_KEYS = [
	"APP_ENV",
	"TDA_LORE_STAGING_TOKEN",
	"R2_PUBLIC_BUCKET",
	"R2_ACCOUNT_ID",
	"R2_ACCESS_KEY_ID",
	"R2_SECRET_ACCESS_KEY",
] as const;

const originalEnv = Object.fromEntries(
	ENV_KEYS.map((key) => [key, process.env[key]]),
) as Record<(typeof ENV_KEYS)[number], string | undefined>;

function clearR2() {
	delete process.env.R2_PUBLIC_BUCKET;
	delete process.env.R2_ACCOUNT_ID;
	delete process.env.R2_ACCESS_KEY_ID;
	delete process.env.R2_SECRET_ACCESS_KEY;
}

afterEach(() => {
	for (const key of ENV_KEYS) {
		const value = originalEnv[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

describe("Yllith release staging authorization", () => {
	it("hides the Production writer when the staging token is absent", async () => {
		process.env.APP_ENV = "production";
		delete process.env.TDA_LORE_STAGING_TOKEN;
		clearR2();

		const response = await POST(
			new Request("https://dnd.faysk.dev/api/internal/lore-yllith-media?file=yllith.avif", {
				method: "POST",
			}),
		);

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ error: "release-staging endpoint" });
	});

	it("rejects an incorrect Production bearer token before R2 access", async () => {
		process.env.APP_ENV = "production";
		process.env.TDA_LORE_STAGING_TOKEN = "expected-release-token";
		clearR2();

		const response = await POST(
			new Request("https://dnd.faysk.dev/api/internal/lore-yllith-media?file=yllith.avif", {
				method: "POST",
				headers: { authorization: "Bearer wrong-release-token" },
			}),
		);

		expect(response.status).toBe(404);
	});

	it("accepts the exact Production token and then fails closed on missing R2 config", async () => {
		process.env.APP_ENV = "production";
		process.env.TDA_LORE_STAGING_TOKEN = "expected-release-token";
		clearR2();

		const response = await POST(
			new Request("https://dnd.faysk.dev/api/internal/lore-yllith-media?file=yllith.avif", {
				method: "POST",
				headers: { authorization: "Bearer expected-release-token" },
			}),
		);

		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({ error: "R2 configuration unavailable" });
	});

	it("keeps Preview staging available without the Production bearer token", async () => {
		process.env.APP_ENV = "preview";
		delete process.env.TDA_LORE_STAGING_TOKEN;
		clearR2();

		const response = await POST(
			new Request("https://preview.example/api/internal/lore-yllith-media?file=yllith.avif", {
				method: "POST",
			}),
		);

		expect(response.status).toBe(503);
	});
});
