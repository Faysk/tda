import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { lembraPersistenceEnabled } from "./server";

const KEYS = ["VERCEL_ENV", "TDA_LEMBRA_ENABLED"] as const;
const original = new Map(KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
	for (const key of KEYS) {
		const value = original.get(key);
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

describe("Lembra persistence runtime", () => {
	it("is always enabled in Production even when the feature flag is absent", () => {
		process.env.VERCEL_ENV = "production";
		delete process.env.TDA_LEMBRA_ENABLED;

		expect(lembraPersistenceEnabled()).toBe(true);
	});

	it("still respects the feature flag outside Production", () => {
		process.env.VERCEL_ENV = "preview";
		process.env.TDA_LEMBRA_ENABLED = "true";
		expect(lembraPersistenceEnabled()).toBe(true);

		process.env.TDA_LEMBRA_ENABLED = "false";
		expect(lembraPersistenceEnabled()).toBe(false);
	});
});
