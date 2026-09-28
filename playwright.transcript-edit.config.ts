import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "tests",
	testMatch: "transcript-edit.spec.ts",
	workers: 1,
	fullyParallel: false,
	use: {
		baseURL: "http://127.0.0.1:3112",
		viewport: { width: 1440, height: 900 },
	},
	webServer: {
		command: "pnpm start --port 3112",
		url: "http://127.0.0.1:3112/api/health",
		reuseExistingServer: false,
		env: {
			TDA_E2E_FIXTURES: "true",
			TDA_READ_PUBLISHED_DATA: "false",
			TDA_EDIT_UNSAFE: "true",
			SUPABASE_PUBLISHABLE_KEY: "",
			TDA_AUTH_ORIGIN: "",
		},
		timeout: 60_000,
	},
});
