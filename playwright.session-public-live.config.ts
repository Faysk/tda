import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "tests",
	testMatch: "session-public-live-audit.spec.ts",
	timeout: 120_000,
	expect: { timeout: 10_000 },
	workers: 1,
	use: {
		baseURL: "https://dnd.faysk.dev",
		colorScheme: "dark",
	},
	projects: [{ name: "live-audit" }],
});
