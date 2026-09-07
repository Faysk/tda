import { defineConfig } from "@playwright/test";
export default defineConfig({
	testDir: "tests/statistics",
	workers: 1,
	use: { baseURL: "http://127.0.0.1:3102" },
	webServer: [
		{
			command: "node tests/statistics/fake-supabase.mjs",
			url: "http://127.0.0.1:3103/health",
			reuseExistingServer: false,
		},
		{
			command: "pnpm start --port 3102",
			url: "http://127.0.0.1:3102/api/health",
			reuseExistingServer: false,
			timeout: 60000,
			env: {
				TDA_READ_PUBLISHED_DATA: "false",
				TDA_READ_EDIT_DATA: "true",
				TDA_EDIT_UNSAFE: "false",
				SUPABASE_URL: "http://127.0.0.1:3103",
				SUPABASE_SECRET_KEY: "synthetic-server-key",
				SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic",
				TDA_AUTH_ORIGIN: "http://127.0.0.1:3102",
			},
		},
	],
	projects: [
		{ name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
		{ name: "mobile", use: { viewport: { width: 390, height: 844 } } },
	],
});
