import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "tests",
	testMatch: ["session-editorial.spec.ts", "legacy-transcript-prepare.spec.ts"],
	workers: 1,
	use: {
		baseURL: "http://127.0.0.1:3106",
		screenshot: "only-on-failure",
		trace: "retain-on-failure",
	},
	webServer: {
		command: "pnpm start --port 3106",
		url: "http://127.0.0.1:3106/api/health",
		reuseExistingServer: false,
		env: {
			TDA_E2E_FIXTURES: "true",
			TDA_READ_PUBLISHED_DATA: "false",
			TDA_READ_EDIT_DATA: "false",
			TDA_EDIT_UNSAFE: "false",
			SUPABASE_PUBLISHABLE_KEY: "",
			TDA_AUTH_ORIGIN: "",
		},
		timeout: 60000,
	},
	projects: [
		{
			name: "chromium",
			use: { viewport: { width: 1440, height: 900 } },
		},
	],
});
