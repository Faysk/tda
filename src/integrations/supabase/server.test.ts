import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { lembraDataClient } from "./server";

const KEYS = [
	"VERCEL_ENV",
	"TDA_LEMBRA_ENABLED",
	"SUPABASE_URL",
	"SUPABASE_SECRET_KEY",
] as const;
const original = new Map(KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
	for (const key of KEYS) {
		const value = original.get(key);
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

describe("Lembra Supabase runtime boundary", () => {
	it("requires the Production data connection even without the feature flag", () => {
		process.env.VERCEL_ENV = "production";
		delete process.env.TDA_LEMBRA_ENABLED;
		delete process.env.SUPABASE_URL;
		delete process.env.SUPABASE_SECRET_KEY;

		expect(() => lembraDataClient()).toThrow(
			"Lembra data connection is not configured",
		);
	});

	it("remains disabled outside Production when the feature flag is off", () => {
		process.env.VERCEL_ENV = "preview";
		process.env.TDA_LEMBRA_ENABLED = "false";
		delete process.env.SUPABASE_URL;
		delete process.env.SUPABASE_SECRET_KEY;

		expect(lembraDataClient()).toBeNull();
	});
});
