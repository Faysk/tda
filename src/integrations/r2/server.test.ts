import { afterEach, describe, expect, it } from "vitest";
import {
	mediaConnectionConfig,
	privateMediaConnectionConfig,
} from "./server";

const KEYS = [
	"R2_ACCOUNT_ID",
	"R2_ACCESS_KEY_ID",
	"R2_SECRET_ACCESS_KEY",
	"R2_PRIVATE_ACCESS_KEY_ID",
	"R2_PRIVATE_SECRET_ACCESS_KEY",
] as const;

const original = new Map(KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
	for (const key of KEYS) {
		const value = original.get(key);
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

describe("R2 server credential boundaries", () => {
	it("keeps public/preview and private credentials separate", () => {
		process.env.R2_ACCOUNT_ID = "a".repeat(32);
		process.env.R2_ACCESS_KEY_ID = "preview-key";
		process.env.R2_SECRET_ACCESS_KEY = "preview-secret";
		process.env.R2_PRIVATE_ACCESS_KEY_ID = "private-key";
		process.env.R2_PRIVATE_SECRET_ACCESS_KEY = "private-secret";

		expect(mediaConnectionConfig()).toEqual({
			accountId: "a".repeat(32),
			accessKeyId: "preview-key",
			secretAccessKey: "preview-secret",
		});
		expect(privateMediaConnectionConfig()).toEqual({
			accountId: "a".repeat(32),
			accessKeyId: "private-key",
			secretAccessKey: "private-secret",
		});
	});

	it("fails closed when the private credential pair is absent", () => {
		process.env.R2_ACCOUNT_ID = "a".repeat(32);
		delete process.env.R2_PRIVATE_ACCESS_KEY_ID;
		delete process.env.R2_PRIVATE_SECRET_ACCESS_KEY;

		expect(() => privateMediaConnectionConfig()).toThrow(
			"Private media connection is not configured",
		);
	});
});
