import { defineConfig } from "@playwright/test";
export default defineConfig({
	testDir: "tools/testing",
	testMatch: "permissions.spec.ts",
	workers: 1,
	use: { baseURL: "http://127.0.0.1:3115" },
	webServer: [
		{
			command: "node tools/testing/permissions-service.mjs",
			url: "http://127.0.0.1:3116/health",
			reuseExistingServer: false,
		},
		{
			command: "pnpm start --port 3115",
			url: "http://127.0.0.1:3115/api/health",
			reuseExistingServer: false,
			timeout: 60000,
			env: {
				SUPABASE_URL: "http://127.0.0.1:3116",
				SUPABASE_PUBLISHABLE_KEY: "sb_publishable_SYNTHETIC",
				SUPABASE_SECRET_KEY: "sb_secret_SYNTHETIC",
				TDA_AUTH_ORIGIN: "http://127.0.0.1:3115",
				TDA_READ_EDIT_DATA: "true",
				TDA_READ_PUBLISHED_DATA: "false",
				TDA_EDIT_UNSAFE: "false",
			},
		},
	],
	projects: [
		{
			name: "permissions-desktop",
			use: { viewport: { width: 1440, height: 1000 } },
		},
		{
			name: "permissions-mobile",
			use: { viewport: { width: 390, height: 844 } },
		},
	],
});
